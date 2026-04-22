/* ═══════════════════════════════════════════
   SecureVault — Multi-Page Interactivity
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Navbar scroll behavior ───
  const navbar = document.getElementById('navbar');
  let lastScroll = 0;

  function handleScroll() {
    const y = window.scrollY;
    // Only toggle scrolled class on pages that have the hero (index.html)
    // Sub-pages already have .scrolled set in HTML
    if (!navbar.classList.contains('scrolled') || document.querySelector('.hero')) {
      if (document.querySelector('.hero')) {
        if (y > 60) {
          navbar.classList.add('scrolled');
        } else {
          navbar.classList.remove('scrolled');
        }
      }
    }
    lastScroll = y;
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // ─── Mobile nav toggle ───
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      const spans = navToggle.querySelectorAll('span');
      if (navLinks.classList.contains('active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        const spans = navToggle.querySelectorAll('span');
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      });
    });
  }

  // ─── Scroll-triggered animations (IntersectionObserver) ───
  const animTargets = document.querySelectorAll(
    '.feature-card, .step, .security-card, .tech-item'
  );

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Stagger delay based on sibling index
            const parent = entry.target.parentElement;
            const siblings = parent ? Array.from(parent.children).filter(el =>
              el.classList.contains(entry.target.classList[0])
            ) : [];
            const idx = siblings.indexOf(entry.target);
            const delay = Math.min(idx * 100, 500);

            setTimeout(() => {
              entry.target.classList.add('visible');
            }, delay);

            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.15,
        rootMargin: '0px 0px -60px 0px',
      }
    );

    animTargets.forEach((el) => observer.observe(el));
  } else {
    // Fallback: show everything
    animTargets.forEach((el) => el.classList.add('visible'));
  }

  // ─── Parallax on hero orbs (subtle, desktop only) ───
  if (window.matchMedia('(min-width: 769px)').matches) {
    const orbs = document.querySelectorAll('.hero-orb');
    let rafId = null;

    if (orbs.length > 0) {
      window.addEventListener('mousemove', (e) => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const x = (e.clientX / window.innerWidth - 0.5) * 2;
          const y = (e.clientY / window.innerHeight - 0.5) * 2;
          orbs.forEach((orb, i) => {
            const factor = (i + 1) * 8;
            orb.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
          });
        });
      }, { passive: true });
    }
  }

  // ─── Console Easter Egg ───
  console.log(
    '%c🛡️ SecureVault — Zero-Plaintext Password Manager',
    'color: #ff3333; font-size: 16px; font-weight: bold;'
  );
  console.log(
    '%cYour credentials are encrypted client-side. The server never sees your passwords.',
    'color: #888; font-size: 12px;'
  );
})();
