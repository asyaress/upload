import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { getOrderDetail, resetOrderForRetry, listStuckOrders, markOrderFailed } from './db.js';
import { buildOrderJobFromDisk } from './orderService.js';
import { enqueueOrderUploadJob, getOrderUploadJobStatus, orderUploadQueue } from './uploadQueue.js';

export async function retryFailedOrder(orderCode) {
  const order = await getOrderDetail(orderCode);

  if (!order) {
    throw new Error('Order tidak ditemukan.');
  }

  if (order.status !== 'failed' && order.status !== 'processing') {
    throw new Error('Hanya order gagal atau macet yang bisa di-retry.');
  }

  const orderDir = path.resolve(config.uploadDir, orderCode);

  try {
    await fs.access(orderDir);
  } catch {
    throw new Error('File lokal tidak ditemukan. Upload ulang order baru diperlukan.');
  }

  const orderJob = await buildOrderJobFromDisk(order);
  await resetOrderForRetry(order.id);

  const existingJob = await orderUploadQueue.getJob(orderCode);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      throw new Error('Upload sedang berjalan. Tunggu hingga selesai.');
    }
    await existingJob.remove();
  }

  await enqueueOrderUploadJob(orderJob);
  return orderJob;
}

export async function reconcileStuckOrders() {
  const stuckOrders = await listStuckOrders(config.stuckOrderMinutes);
  let reconciled = 0;

  for (const order of stuckOrders) {
    try {
      const jobStatus = await getOrderUploadJobStatus(order.order_code);
      const activeStates = new Set(['active', 'waiting', 'delayed']);

      if (jobStatus && activeStates.has(jobStatus.state)) {
        continue;
      }

      const orderDir = path.resolve(config.uploadDir, order.order_code);

      try {
        await fs.access(orderDir);
      } catch {
        await markOrderFailed(
          order.id,
          'Order macet: file lokal tidak ditemukan untuk retry otomatis.'
        );
        continue;
      }

      const orderJob = await buildOrderJobFromDisk(order);
      await resetOrderForRetry(order.id);

      const existingJob = await orderUploadQueue.getJob(order.order_code);
      if (existingJob) {
        await existingJob.remove();
      }

      await enqueueOrderUploadJob(orderJob);
      reconciled += 1;
      console.log(`Reconcile: order ${order.order_code} di-requeue.`);
    } catch (error) {
      console.error(`Reconcile gagal untuk ${order.order_code}:`, error.message);
    }
  }

  return reconciled;
}

export function startReconciliationScheduler() {
  const intervalMs = 5 * 60 * 1000;

  setInterval(() => {
    reconcileStuckOrders().catch((error) => {
      console.error('Reconciliation scheduler error:', error.message);
    });
  }, intervalMs);

  reconcileStuckOrders().catch((error) => {
    console.error('Initial reconciliation error:', error.message);
  });
}
