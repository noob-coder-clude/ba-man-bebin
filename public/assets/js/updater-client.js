document.addEventListener('DOMContentLoaded', async () => {
  const updateBar = document.getElementById('updateBar');
  const updateBtn = document.getElementById('updateBtn');
  if (!updateBar || !updateBtn) return;

  try {
    const res = await fetch('/api/update-status');
    const data = await res.json();
    if (data.available) {
      updateBar.style.display = 'block';
    }
  } catch (e) {}

  updateBtn.addEventListener('click', async () => {
    const token = prompt('ADMIN_TOKEN را وارد کنید:');
    if (!token) return;

    try {
      updateBtn.disabled = true;
      updateBtn.textContent = 'در حال اجرا...';
      const res = await fetch('/api/admin/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        alert('به‌روزرسانی شروع شد. سرور تا لحظاتی دیگر ری‌استارت می‌شود.');
      } else {
        alert('خطا: ' + (data.error || 'دسترسی غیرمجاز'));
        updateBtn.disabled = false;
        updateBtn.textContent = 'به‌روزرسانی کن';
      }
    } catch (e) {
      alert('خطا در ارتباط با سرور');
      updateBtn.disabled = false;
      updateBtn.textContent = 'به‌روزرسانی کن';
    }
  });
});
