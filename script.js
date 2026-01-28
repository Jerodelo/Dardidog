// ========================================
// SCRIPT PRINCIPAL - DARDIDOG
// ========================================

// Charger le header et le footer
async function loadPartials() {
  const headerResponse = await fetch('partials/header.html');
  const headerData = await headerResponse.text();
  document.getElementById('header-placeholder').innerHTML = headerData;

  const footerResponse = await fetch('partials/footer.html');
  const footerData = await footerResponse.text();
  document.getElementById('footer-placeholder').innerHTML = footerData;

  initMobileMenu();
  initLightbox();
  setActivePage();
}

// Indiquer la page active dans la navigation
function setActivePage() {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // Sélectionner tous les liens de navigation (desktop et mobile)
  const navLinks = document.querySelectorAll('nav a, .mobile-nav a');

  navLinks.forEach(link => {
    const linkPage = link.getAttribute('href').split('#')[0]; // Enlever les ancres #balades, etc.

    if (linkPage === currentPage ||
        (currentPage === '' && linkPage === 'index.html') ||
        (currentPage === 'index.html' && linkPage === 'index.html')) {
      link.classList.add('active');
    }
  });
}

// Initialiser le menu mobile
function initMobileMenu() {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const nav = document.getElementById('mobileNav');

  if (toggle && nav) {
    // Toggle du menu burger mobile
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      nav.classList.toggle('active');
    });

    // Toggle accordion pour les sous-menus (dropdown mobile)
    document.querySelectorAll('.mobile-dropdown-toggle').forEach(link => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        link.classList.toggle('active');
        const content = link.closest('.mobile-dropdown').querySelector('.mobile-dropdown-content');
        if (content) {
          content.classList.toggle('active');
        }
      });
    });

    // Fermer le menu quand on clique sur un lien (sauf les toggles accordion)
    document.querySelectorAll('.mobile-nav a:not(.mobile-dropdown-toggle)').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('active');
        nav.classList.remove('active');
      });
    });

    // Fermer le menu quand on clique en dehors
    document.addEventListener('click', (e) => {
      const header = document.querySelector('header');
      if (nav.classList.contains('active') && !header.contains(e.target)) {
        toggle.classList.remove('active');
        nav.classList.remove('active');
      }
    });
  }
}

// Initialiser la lightbox (si présente sur la page)
function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.querySelector('.lightbox-close');

  // Ouvrir la lightbox au clic sur une image de la galerie
  document.querySelectorAll('.photo-item img').forEach(img => {
    img.addEventListener('click', () => {
      const src = img.src.replace('-small', '-large').replace('-medium', '-large');
      lightboxImg.src = src;
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  // Fermer la lightbox
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxClose) {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // Fermer avec Echap
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightbox.classList.contains('active')) {
      lightbox.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
}

// ===== CAROUSEL AVIS (page contact uniquement) =====
function initAvisCarousel() {
  const track = document.querySelector('.avis-track');
  if (!track) return; // Si pas de carousel sur cette page, on ne fait rien

  const cards = document.querySelectorAll('.avis-card');
  const totalCards = cards.length;
  let index = 0;
  let autoSlideInterval;

  function getVisibleCards() {
    return window.innerWidth <= 768 ? 1 : (window.innerWidth <= 900 ? 2 : 3);
  }

  function updateCarousel() {
    if (index === 0) {
      track.style.transform = `translateX(0px)`;
    } else {
      const targetCard = cards[index];
      const offset = targetCard.offsetLeft;
      track.style.transform = `translateX(-${offset}px)`;
    }
  }

  function moveCarousel(direction) {
    const visibleCards = getVisibleCards();
    const maxIndex = totalCards - visibleCards;

    index += direction;

    if (index < 0) {
      index = maxIndex;
    } else if (index > maxIndex) {
      index = 0;
    }

    updateCarousel();
    resetAutoSlide();
  }

  function autoSlide() {
    moveCarousel(1);
  }

  function resetAutoSlide() {
    clearInterval(autoSlideInterval);
    autoSlideInterval = setInterval(autoSlide, 5000);
  }

  // Exposer moveCarousel globalement pour les boutons onclick
  window.moveCarousel = moveCarousel;

  window.addEventListener('load', updateCarousel);
  window.addEventListener('resize', updateCarousel);
  autoSlideInterval = setInterval(autoSlide, 5000);
}




// Lancer au chargement de la page
loadPartials().then(() => {
  initAvisCarousel();
});
