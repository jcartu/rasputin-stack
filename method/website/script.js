/* ============================================
   THE operator METHOD — Interactions & Charts
   ============================================ */

// --- Benchmark Data ---
const benchmarkData = [
  { model: 'Gemini 3 Flash',           time: 20.4,  chars: 6909,  items: 71,   quality: 92.9,  cost: 0.003, category: 'cloud',  running: false },
  { model: 'Gemini 3 Pro',             time: 38.3,  chars: 8825,  items: 81,   quality: 92.9,  cost: 0.051, category: 'cloud',  running: false },
  { model: 'Gemini 2.0 Flash',         time: 42.2,  chars: 29822, items: 198,  quality: 96.4,  cost: 0.006, category: 'cloud',  running: false },
  { model: 'Gemini 2.5 Flash',         time: 64.2,  chars: 46255, items: 332,  quality: 100.0, cost: 0.012, category: 'cloud',  running: false },
  { model: 'Gemini 2.5 Pro',           time: 117.7, chars: 41584, items: 298,  quality: 100.0, cost: 0.151, category: 'cloud',  running: false },
  { model: 'Sonnet 4.6 (No Thinking)', time: 189.0, chars: 23170, items: 192,  quality: 100.0, cost: 0.179, category: 'cloud',  running: false },
  { model: 'Sonnet 4.6 (Thinking)',    time: 227.1, chars: 25856, items: 200,  quality: 85.0,  cost: 0.16,  category: 'cloud',  running: false },
  { model: 'Opus 4.6 (Thinking)',      time: 379.2, chars: 42662, items: 250,  quality: 95.0,  cost: 0.61,  category: 'cloud',  running: false },
  { model: 'Qwen 3 Coder 30B',         time: 104.0, chars: 44267, items: 310,  quality: 100.0, cost: 0.00,  category: 'local',  running: false },
  { model: 'Qwen 2.5 72B',            time: 528.7, chars: 43596, items: 305,  quality: 100.0, cost: 0.00,  category: 'local',  running: false },
];

// Sweet spot models
const sweetSpotModels = ['Gemini 2.5 Flash', 'Qwen 3 Coder 30B'];

// --- Particle Background ---
function initParticles() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }

  function createParticles() {
    particles = [];
    const count = Math.floor((w * h) / 15000);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(59, 130, 246, ${0.06 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // Draw particles
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(59, 130, 246, ${p.alpha})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }

    requestAnimationFrame(draw);
  }

  resize();
  createParticles();
  draw();

  window.addEventListener('resize', () => {
    resize();
    createParticles();
  });
}

// --- Intersection Observer for Reveals ---
function initRevealObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}

// --- Counter Animation ---
function animateCounter(el, target, suffix = '', prefix = '') {
  const duration = 2000;
  const startTime = performance.now();
  const startVal = 0;

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = startVal + (target - startVal) * eased;

    if (Number.isInteger(target)) {
      el.textContent = prefix + Math.round(current) + suffix;
    } else {
      el.textContent = prefix + current.toFixed(1) + suffix;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

function initCounters() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.animated) {
          entry.target.dataset.animated = 'true';
          const target = parseFloat(entry.target.dataset.target);
          const suffix = entry.target.dataset.suffix || '';
          const prefix = entry.target.dataset.prefix || '';
          animateCounter(entry.target, target, suffix, prefix);
        }
      });
    },
    { threshold: 0.5 }
  );

  document.querySelectorAll('[data-counter]').forEach((el) => observer.observe(el));
}

// --- Quality Bars Animation ---
function initQualityBars() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const bar = entry.target.querySelector('.quality-bar-fill');
          if (bar) {
            const width = bar.dataset.width;
            setTimeout(() => {
              bar.style.width = width + '%';
            }, 200);
          }
        }
      });
    },
    { threshold: 0.3 }
  );

  document.querySelectorAll('.model-card').forEach((el) => observer.observe(el));
}

// --- Navbar Scroll ---
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  });
}

// --- Charts ---
let timeChart, scatterChart;

function getChartColors() {
  return {
    blue: '#3b82f6',
    blueAlpha: 'rgba(59, 130, 246, 0.6)',
    amber: '#f59e0b',
    amberAlpha: 'rgba(245, 158, 11, 0.6)',
    green: '#22c55e',
    greenAlpha: 'rgba(34, 197, 94, 0.6)',
    red: '#ef4444',
    gridColor: 'rgba(255, 255, 255, 0.04)',
    tickColor: 'rgba(255, 255, 255, 0.4)',
  };
}

function initTimeChart() {
  const ctx = document.getElementById('timeChart');
  if (!ctx) return;

  const colors = getChartColors();
  const cloudData = benchmarkData.filter(d => !d.running);

  timeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: cloudData.map(d => d.model),
      datasets: [{
        label: 'Compaction Time (seconds)',
        data: cloudData.map(d => d.time),
        backgroundColor: cloudData.map(d =>
          sweetSpotModels.includes(d.model) ? colors.amberAlpha : colors.blueAlpha
        ),
        borderColor: cloudData.map(d =>
          sweetSpotModels.includes(d.model) ? colors.amber : colors.blue
        ),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1500,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a2e',
          titleColor: '#fff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          callbacks: {
            label: (ctx) => `  ${ctx.parsed.x}s`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: colors.gridColor, drawBorder: false },
          ticks: { color: colors.tickColor, font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => v + 's' },
          title: { display: true, text: 'Time (seconds)', color: 'rgba(255,255,255,0.3)', font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: colors.tickColor, font: { family: "'Inter', sans-serif", size: 12 } },
        },
      },
    },
  });
}

function initScatterChart() {
  const ctx = document.getElementById('scatterChart');
  if (!ctx) return;

  const colors = getChartColors();
  const cloudData = benchmarkData.filter(d => !d.running);

  scatterChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Models',
        data: cloudData.map(d => ({
          x: d.time,
          y: d.quality,
          r: Math.max(8, Math.sqrt(d.chars) / 5),
          model: d.model,
          cost: d.cost,
        })),
        backgroundColor: cloudData.map(d =>
          sweetSpotModels.includes(d.model) ? colors.amberAlpha : colors.blueAlpha
        ),
        borderColor: cloudData.map(d =>
          sweetSpotModels.includes(d.model) ? colors.amber : colors.blue
        ),
        borderWidth: 1.5,
        pointRadius: cloudData.map(d => Math.max(6, Math.sqrt(d.chars) / 6)),
        pointHoverRadius: cloudData.map(d => Math.max(8, Math.sqrt(d.chars) / 6 + 2)),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1500,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a2e',
          titleColor: '#fff',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          titleFont: { family: "'Inter', sans-serif", weight: '600' },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          callbacks: {
            title: (items) => items[0]?.raw?.model || '',
            label: (ctx) => [
              `  Time: ${ctx.parsed.x}s`,
              `  Quality: ${ctx.parsed.y}%`,
              `  Cost: $${ctx.raw.cost}`,
            ],
          },
        },
      },
      scales: {
        x: {
          grid: { color: colors.gridColor, drawBorder: false },
          ticks: { color: colors.tickColor, font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => v + 's' },
          title: { display: true, text: 'Compaction Time (seconds)', color: 'rgba(255,255,255,0.3)', font: { size: 11 } },
        },
        y: {
          min: 80,
          max: 102,
          grid: { color: colors.gridColor, drawBorder: false },
          ticks: { color: colors.tickColor, font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => v + '%' },
          title: { display: true, text: 'Key Facts Retained (%)', color: 'rgba(255,255,255,0.3)', font: { size: 11 } },
        },
      },
    },
  });
}

// Chart initialization on scroll
function initChartObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.chartInit) {
          entry.target.dataset.chartInit = 'true';
          const chartId = entry.target.querySelector('canvas')?.id;
          if (chartId === 'timeChart') initTimeChart();
          if (chartId === 'scatterChart') initScatterChart();
        }
      });
    },
    { threshold: 0.2 }
  );

  document.querySelectorAll('.chart-container').forEach((el) => observer.observe(el));
}

// --- Filter Controls ---
function initFilters() {
  const buttons = document.querySelectorAll('.btn-filter');
  const cards = document.querySelectorAll('.model-card');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      cards.forEach(card => {
        if (filter === 'all' || card.dataset.category === filter) {
          card.style.display = '';
          card.style.opacity = '1';
          card.style.transform = '';
        } else {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
          setTimeout(() => { card.style.display = 'none'; }, 300);
        }
      });
    });
  });
}

// --- Sort Controls ---
function initSort() {
  const select = document.getElementById('sortMetric');
  if (!select) return;

  select.addEventListener('change', () => {
    const metric = select.value;
    const grid = document.querySelector('.model-cards-grid');
    const cards = Array.from(grid.children);

    cards.sort((a, b) => {
      const aVal = parseFloat(a.dataset[metric]) || Infinity;
      const bVal = parseFloat(b.dataset[metric]) || Infinity;
      if (metric === 'quality') return bVal - aVal;
      return aVal - bVal;
    });

    cards.forEach(card => grid.appendChild(card));
  });
}

// --- Smooth Scroll for Nav Links ---
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// --- Initialize Everything ---
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initRevealObserver();
  initCounters();
  initQualityBars();
  initNavScroll();
  initChartObserver();
  initFilters();
  initSort();
  initSmoothScroll();
});
