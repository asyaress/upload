import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config.js';
import { createNotaOcrPending } from './db.js';
import { processNotaOcrJobSafe } from './notaOcrService.js';
import { processOrderUploadJob } from './orderService.js';

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null
});

export const notaOcrQueue = new Queue('nota-ocr', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10_000
    },
    removeOnComplete: 100,
    removeOnFail: 200
  }
});

export const orderUploadQueue = new Queue('order-upload', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100,
    removeOnFail: 200
  }
});

export async function enqueueOrderUploadJob(orderJob) {
  const existingJob = await orderUploadQueue.getJob(orderJob.orderCode);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return existingJob;
    }
    await existingJob.remove();
  }

  return orderUploadQueue.add('upload-order', orderJob, {
    jobId: orderJob.orderCode
  });
}

export async function getOrderUploadJobStatus(orderCode) {
  const job = await orderUploadQueue.getJob(orderCode);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = typeof job.progress === 'object' ? job.progress : { percent: 0 };

  return {
    state,
    progress
  };
}

export async function enqueueNotaOcrJob(ocrJob) {
  await createNotaOcrPending({
    orderId: ocrJob.orderId,
    orderCode: ocrJob.orderCode,
    itemCountExpected: ocrJob.itemCount
  });

  const jobId = `ocr-${ocrJob.orderCode}`;
  const existingJob = await notaOcrQueue.getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return existingJob;
    }
    await existingJob.remove();
  }

  return notaOcrQueue.add('process-nota-ocr', ocrJob, { jobId });
}

export async function getNotaOcrJobStatus(orderCode) {
  const job = await notaOcrQueue.getJob(`ocr-${orderCode}`);

  if (!job) {
    return null;
  }

  const state = await job.getState();

  return {
    state,
    failedReason: job.failedReason || null
  };
}

export function startOrderUploadWorker() {
  const worker = new Worker(
    'order-upload',
    async (job) => processOrderUploadJob(job.data, job),
    {
      connection,
      concurrency: 2,
      // Upload multi-GB ke Drive bisa memakan waktu lama
      lockDuration: 3_600_000, // 1 jam
      stalledInterval: 120_000,
      maxStalledCount: 5
    }
  );

  worker.on('failed', (job, error) => {
    console.error(`Upload background gagal untuk ${job?.data?.orderCode}:`, error.message);
  });

  worker.on('completed', (job) => {
    console.log(`Upload selesai: ${job?.data?.orderCode}`);
  });

  return worker;
}

export function startNotaOcrWorker() {
  const worker = new Worker(
    'nota-ocr',
    async (job) => processNotaOcrJobSafe(job.data),
    {
      connection,
      concurrency: config.ocr.workerConcurrency,
      lockDuration: 1_800_000,
      stalledInterval: 120_000,
      maxStalledCount: 3
    }
  );

  worker.on('failed', (job, error) => {
    console.error(`OCR nota gagal untuk ${job?.data?.orderCode}:`, error.message);
  });

  worker.on('completed', (job) => {
    console.log(`OCR nota selesai: ${job?.data?.orderCode}`);
  });

  return worker;
}
