import { initLangSwitch, t } from './i18n.js';

initLangSwitch();

document.getElementById('year').textContent = new Date().getFullYear();

/* Mobile nav */
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
navToggle?.addEventListener('click', () => navLinks.classList.toggle('is-open'));
navLinks?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => navLinks.classList.remove('is-open')));

/* Toast */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
}

/* Create room */
async function createRoom(button) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = '…';
  }
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    window.location.href = data.url;
  } catch {
    toast('⚠️ ' + t('room.disconnected'));
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

document.querySelectorAll('[data-create-room]').forEach((btn) => {
  btn.addEventListener('click', () => createRoom(btn));
});

/* Join by ID */
document.getElementById('joinForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = document.getElementById('roomInput').value.trim().toLowerCase();
  const id = raw.replace(/^.*\/room\//, '').replace(/[^a-z0-9-]/g, '');
  if (!id) return;
  window.location.href = `/room/${id}`;
});

/* Reveal on scroll */
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 6, 5) * 60}ms`;
  observer.observe(el);
});

/* Live stats in the hero (optional, silent failure) */
fetch('/api/stats')
  .then((r) => r.json())
  .then((s) => {
    if (s?.rooms >= 0) {
      const el = document.querySelector('.pill .dot')?.parentElement;
      if (el && s.users > 0) el.lastElementChild.textContent = `${s.users} online · ${s.rooms} rooms`;
    }
  })
  .catch(() => {});
