const totpInput = document.querySelector('input[name="code"]');

if (totpInput) {
  totpInput.addEventListener('input', () => {
    totpInput.value = totpInput.value.replace(/\D/g, '').slice(0, 6);
  });
}
