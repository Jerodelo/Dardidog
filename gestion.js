// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

const PUSH_WORKER_URL  = 'https://dardidog-push.jeromine-deloffre.workers.dev';
const PUSH_VAPID_KEY   = 'BKWBZk6fttcxjtGGTm2WmIapg1nnYoLaMZ_MlogG098mvgSXycyZzC8QiRUVfX0KIeJh5Wz2XJync3YnyEi0eus';

function urlBase64ToUint8Array(base64String) {
  const pad = (4 - (base64String.length % 4)) % 4;
  const base64 = (base64String + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function syncEventsPush() {
  if (!PUSH_WORKER_URL) return;
  const today = new Date().toISOString().split('T')[0];
  const futureEvents = (state.evenements || []).filter(ev => {
    const refDate = ev.date || ev.dateDebut || '';
    return refDate >= today;
  });
  const futurePrestations = (state.prestations || [])
    .filter(p => p.date >= today)
    .map(p => ({
      id: p.id,
      type: p.hdebut ? 'heure' : 'journee',
      date: p.date,
      heureDebut: p.hdebut || undefined,
      datetimeISO: p.hdebut ? new Date(`${p.date}T${p.hdebut}:00`).toISOString() : new Date(`${p.date}T08:00:00`).toISOString(),
      nom: `${p.animal} — ${p.prestation || 'Prestation'}`,
    }));
  const allEvents = [...futureEvents, ...futurePrestations].map(ev => ({
    ...ev,
    datetimeISO: ev.datetimeISO || (
      ev.type === 'heure' && ev.date && ev.heureDebut ? new Date(`${ev.date}T${ev.heureDebut}:00`).toISOString() :
      ev.type === 'journee' && ev.date ? new Date(`${ev.date}T08:00:00`).toISOString() :
      ev.type === 'periode' && ev.dateDebut ? new Date(`${ev.dateDebut}T08:00:00`).toISOString() : undefined
    ),
  }));
  fetch(`${PUSH_WORKER_URL}/sync-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(allEvents),
  }).catch(() => {});
}

async function registerPushNotifications() {
  if (!PUSH_WORKER_URL) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    const reg = await navigator.serviceWorker.ready;

    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_KEY),
      });
      await fetch(`${PUSH_WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    }
    syncEventsPush();
  } catch (e) {
    console.warn('Push setup failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════

const MOIS_LIST = ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

const DEFAULT_CONFIG = {
  nom: '',
  statut: '',
  siret: '',
  ape: '',
  adresse1: '',
  adresse2: '',
};

const DEFAULT_PRESTATIONS_TYPES = [
  'Balade quartier 30 min','Balade quartier 45 min','Balade quartier 1h',
  'Balade nature 30 min','Balade nature 45 min','Balade nature 1h',
  'Forfait 2x30 min balade','Visite à domicile 30 min','Visite à domicile 45 min',
  'Visite à domicile 1h','Forfaits 2x30 min visite','Garderie journée chien'
];

const DEFAULT_CLIENTS = [];

// Excel serial date → JS Date
function excelDateToJS(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}
function formatDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('fr-FR');
}
function dateToISO(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  const y = dt.getFullYear();
  const mo = String(dt.getMonth()+1).padStart(2,'0');
  const da = String(dt.getDate()).padStart(2,'0');
  return y + '-' + mo + '-' + da;
}
function getMoisFromDate(iso) {
  const d = new Date(iso);
  return MOIS_LIST[d.getMonth()];
}
function moisToNum(m) { return MOIS_LIST.indexOf(m.toLowerCase()); }

// ═══════════════════════════════════════════════════════════════
// STATE (localStorage)
// ═══════════════════════════════════════════════════════════════

function loadState() {
  try {
    const raw = localStorage.getItem('petsitter_data');
    if (raw) {
      const data = JSON.parse(raw);
      data.depenses = data.depenses || [];
      data.caExtra = data.caExtra || [];
      data.evenements = data.evenements || [];
      data.config = data.config || {...DEFAULT_CONFIG};
      return data;
    }
  } catch(e) {}
  return null;
}

function getDefaultState() {
  const prestations = [];
  const recettes = [];

  return {
    prestations,
    recettes,
    depenses: [],
    caExtra: [],
    evenements: [],
    clients: DEFAULT_CLIENTS.map(c => ({...c, id: uid()})),
    prestationsTypes: [...DEFAULT_PRESTATIONS_TYPES],
    lastFactureNum: 2,
    config: {...DEFAULT_CONFIG},
  };
}

let state = loadState() || getDefaultState();

function runMigrations() {
  // v1 : datePaiement pour recettes payées sans date de paiement
  if (!localStorage.getItem('migration_v1_done')) {
    let changed = false;
    (state.recettes || []).forEach(r => {
      if (r.statut === 'Payé' && !r.datePaiement && r.date) {
        const d = new Date(r.date);
        d.setDate(d.getDate() + 2);
        r.datePaiement = d.toISOString().slice(0, 10);
        changed = true;
      }
    });
    if (changed) saveState();
    localStorage.setItem('migration_v1_done', '1');
  }

  // v2 : lier les prestations non facturées aux recettes qui les couvrent
  // (v1 utilisait moisCle === p.mois ce qui est toujours faux — formats différents)
  if (!localStorage.getItem('migration_v2_done')) {
    let changed = false;
    (state.recettes || []).forEach(r => {
      getPrestsForRecette(r).forEach(p => {
        if (!p.facture) { p.facture = r.ref; changed = true; }
      });
    });
    if (changed) saveState();
    localStorage.setItem('migration_v2_done', '1');
  }

  // v3 : remplir le mode de paiement manquant sur les recettes depuis le client
  if (!localStorage.getItem('migration_v3_done')) {
    let changed = false;
    (state.recettes || []).forEach(r => {
      if (!r.mode) {
        const client = (state.clients || []).find(c => c.nom === r.client);
        if (client && client.mode) { r.mode = client.mode; changed = true; }
      }
    });
    if (changed) saveState();
    localStorage.setItem('migration_v3_done', '1');
  }
}

function saveState() {
  localStorage.setItem('petsitter_data', JSON.stringify(state));
  localStorage.setItem('petsitter_data_mtime', Date.now().toString());
}

function exportBackup() {
  const date = new Date();
  const stamp = date.getFullYear() + '-' +
    String(date.getMonth()+1).padStart(2,'0') + '-' +
    String(date.getDate()).padStart(2,'0');
  const blob = new Blob([JSON.stringify({ ...state, notes: loadNotes() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dardidog-sauvegarde-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2,5);
}

function calcAge(naissance) {
  if (!naissance) return null;
  const birth = new Date(naissance + 'T00:00:00');
  const today = new Date();
  const totalMois = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  const arrondi = Math.round(totalMois / 6) * 6;
  if (arrondi <= 0) return 'Moins de 6 mois';
  const ans = Math.floor(arrondi / 12);
  const demi = arrondi % 12 === 6;
  if (ans === 0) return '6 mois';
  return `${ans} an${ans > 1 ? 's' : ''}${demi ? ' et demi' : ''}`;
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('[data-page]').forEach(a => {
    a.classList.toggle('active', a.dataset.page === name);
  });
  if (name === 'bilan') renderBilan();
  if (name === 'notes') renderNotes();
  if (name === 'recettes') switchFacturesTab('form');
  if (name === 'prestations') switchPrestationsTab('indiv');
  if (name === 'depenses') {
    switchChargesTab('form');
    document.getElementById('dep-date').value = dateToISO(new Date());
  }
  if (name === 'clients') switchClientsVue('animaux');
  if (name === 'donnees') switchDonneesTab('presta');
  if (name === 'planning') { jourDate = new Date(); renderPlanning(); }
}

const _navOverlay = document.createElement('div');
_navOverlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:998;';
document.body.appendChild(_navOverlay);
_navOverlay.addEventListener('click', () => closeMobileNav());

function closeMobileNav() {
  document.getElementById('mobileNav').classList.remove('active');
  document.getElementById('burgerBtn').classList.remove('active');
  _navOverlay.style.display = 'none';
}

document.getElementById('burgerBtn').addEventListener('click', function() {
  const open = document.getElementById('mobileNav').classList.toggle('active');
  this.classList.toggle('active');
  _navOverlay.style.display = open ? 'block' : 'none';
});

// ═══════════════════════════════════════════════════════════════
// SELECTS POPULÉS
// ═══════════════════════════════════════════════════════════════

function getAllAnimaux() {
  // Returns flat list of {nom, proprietaire, prestation, tarif}
  const list = [];
  state.clients.forEach(c => {
    (c.animaux || []).forEach(a => {
      list.push({ nom: a.nom, proprietaire: c.nom, prestation: a.prestation || '', tarif: a.tarif || 0 });
    });
  });
  return list.sort((a,b) => a.nom.localeCompare(b.nom));
}

function getProprietaireByAnimal(animalNom) {
  for (const c of state.clients) {
    if ((c.animaux||[]).find(a => a.nom === animalNom)) return c;
  }
  return null;
}

function populateSelects() {
  const animaux = getAllAnimaux();
  const animalNames = animaux.map(a => a.nom);
  const proprietaireNames = [...new Set(state.clients.map(c => c.nom))].sort();
  const types = state.prestationsTypes;

  // Animal selects (saisie prestations)
  ['p-animal','lot-animal'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">-- Choisir --</option>' +
      animalNames.map(a => `<option ${a===val?'selected':''}>${a}</option>`).join('');
  });

  // Prestation selects
  ['p-prestation','lot-prestation'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">-- Choisir --</option>' +
      types.map(t => `<option ${t===val?'selected':''}>${t}</option>`).join('');
  });

  // Propriétaire select (recettes) — affiché par animal, valeur = client
  const rClient = document.getElementById('r-client');
  if (rClient) {
    const rcVal = rClient.value;
    const animauxOptions = [];
    state.clients.forEach(c => (c.animaux || []).forEach(a => animauxOptions.push({ label: a.nom, value: c.nom })));
    animauxOptions.sort((a, b) => a.label.localeCompare(b.label));
    rClient.innerHTML = '<option value="">-- Choisir --</option>' +
      animauxOptions.map(o => `<option value="${o.value}" ${o.value===rcVal?'selected':''}>${o.label}</option>`).join('');
  }

  const now = new Date();
  const defAnnee = String(now.getFullYear());
  const defMois  = MOIS_LIST[now.getMonth()];

  // Filtres prestations
  const fmP = document.getElementById('filter-mois');
  if (fmP) {
    const val = fmP.value || defMois;
    const base = MOIS_LIST.filter(m => state.prestations.some(p => p.date && getMoisFromDate(p.date) === m));
    const moisDispoP = base.includes(defMois) ? base : [...base, defMois].sort((a,b) => MOIS_LIST.indexOf(a)-MOIS_LIST.indexOf(b));
    fmP.innerHTML = '<option value="">Mois</option>' +
      moisDispoP.map(m => `<option ${m===val?'selected':''}>${m}</option>`).join('');
  }

  const faP = document.getElementById('filter-annee-p');
  if (faP) {
    const val = faP.value || defAnnee;
    const base = [...new Set(state.prestations.map(p => p.date ? p.date.slice(0,4) : null).filter(Boolean))].sort().reverse();
    const annees = base.includes(defAnnee) ? base : [defAnnee, ...base];
    faP.innerHTML = '<option value="">Année</option>' +
      annees.map(a => `<option ${a===val?'selected':''}>${a}</option>`).join('');
  }

  // Filtres factures
  const fmR = document.getElementById('filter-mois-r');
  if (fmR) {
    const val = fmR.value || defMois;
    const base = MOIS_LIST.filter(m => state.recettes.some(r => r.date && getMoisFromDate(r.date) === m));
    const moisDispo = base.includes(defMois) ? base : [...base, defMois].sort((a,b) => MOIS_LIST.indexOf(a)-MOIS_LIST.indexOf(b));
    fmR.innerHTML = '<option value="">Mois</option>' +
      moisDispo.map(m => `<option ${m===val?'selected':''}>${m}</option>`).join('');
  }

  const faR = document.getElementById('filter-annee-r');
  if (faR) {
    const val = faR.value || defAnnee;
    const base = [...new Set(state.recettes.map(r => r.date ? r.date.slice(0,4) : null).filter(Boolean))].sort().reverse();
    const annees = base.includes(defAnnee) ? base : [defAnnee, ...base];
    faR.innerHTML = '<option value="">Année</option>' +
      annees.map(a => `<option ${a===val?'selected':''}>${a}</option>`).join('');
  }

  const fcR = document.getElementById('filter-client-r');
  if (fcR) {
    const val = fcR.value;
    const clients = [...new Set(state.recettes.map(r => r.client))].sort();
    fcR.innerHTML = '<option value="">Client</option>' +
      clients.map(c => `<option ${c===val?'selected':''}>${c}</option>`).join('');
  }

  // Sélecteurs mois et année formulaire facture
  const rMois = document.getElementById('r-mois');
  if (rMois) {
    const val = rMois.value || defMois;
    rMois.innerHTML = '<option value="">-- Choisir --</option>' +
      MOIS_LIST.map(m => `<option ${m===val?'selected':''}>${m}</option>`).join('');
  }
  const rMois2 = document.getElementById('r-mois2');
  if (rMois2) {
    const cur = rMois2.value;
    rMois2.innerHTML = '<option value="">-- Choisir --</option>' +
      MOIS_LIST.map(m => `<option ${m===cur?'selected':''}>${m}</option>`).join('');
    if (!cur && rMois && rMois.value) autoFillMois2();
  }

  const rAnnee = document.getElementById('r-annee');
  if (rAnnee) {
    const val = rAnnee.value || defAnnee;
    const base = [...new Set(state.prestations.map(p => p.date ? p.date.slice(0,4) : null).filter(Boolean))].sort().reverse();
    const annees = base.includes(defAnnee) ? base : [defAnnee, ...base];
    rAnnee.innerHTML = annees.map(a => `<option ${a===val?'selected':''}>${a}</option>`).join('');
  }

  // Filtre animal
  const fa = document.getElementById('filter-animal');
  if (fa) {
    const val = fa.value;
    fa.innerHTML = '<option value="">Animal</option>' +
      animalNames.map(a => `<option ${a===val?'selected':''}>${a}</option>`).join('');
  }
}

function onAnimalChange(prefix) {
  const animal = document.getElementById(prefix+'-animal').value;
  const proprio = getProprietaireByAnimal(animal);
  const animalData = proprio ? (proprio.animaux||[]).find(a => a.nom === animal) : null;
  document.getElementById(prefix+'-client').value = proprio ? proprio.nom : '';
  if (animalData) {
    const prestSel = document.getElementById(prefix+'-prestation');
    if (prestSel && animalData.prestation) prestSel.value = animalData.prestation;
    const montInput = document.getElementById(prefix+'-montant');
    if (montInput && animalData.tarif) montInput.value = animalData.tarif;
  }
  onPrestationChange(prefix);
}

function onPrestationChange(prefix) {
  const val = (document.getElementById(prefix + '-prestation').value || '').toLowerCase();
  const isForfait = val.includes('forfait') && val.includes('2x30');
  const slot2 = document.getElementById(prefix + '-slot2');
  if (slot2) slot2.style.display = isForfait ? 'block' : 'none';
  if (!isForfait) {
    const el2 = document.getElementById(prefix + '-hdebut2');
    const el3 = document.getElementById(prefix + '-hfin2');
    if (el2) el2.value = '';
    if (el3) el3.value = '';
  }
  autoFillHeureFin(prefix);
}

function parseDureeMinutes(prestationLabel) {
  const v = (prestationLabel || '').toLowerCase();
  const m2h  = v.match(/(\d+)\s*h30/);
  const m1h  = v.match(/(\d+)\s*h(?!30)/);
  const m30m = v.match(/(\d+)\s*min/);
  if (m2h)  return parseInt(m2h[1])  * 60 + 30;
  if (m1h)  return parseInt(m1h[1])  * 60;
  if (m30m) return parseInt(m30m[1]);
  return null;
}

function autoFillHeureFin2(prefix) {
  const hdebut2 = document.getElementById(prefix + '-hdebut2');
  const hfin2   = document.getElementById(prefix + '-hfin2');
  if (!hdebut2 || !hfin2 || !hdebut2.value) return;
  const [h, m] = hdebut2.value.split(':').map(Number);
  const total = h * 60 + m + 30;
  hfin2.value = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

function autoFillHeureFin(prefix) {
  const hdebut = document.getElementById(prefix + '-hdebut');
  const hfin   = document.getElementById(prefix + '-hfin');
  const prest  = document.getElementById(prefix + '-prestation');
  if (!hdebut || !hfin || !prest || !hdebut.value) return;
  const duree = parseDureeMinutes(prest.value);
  if (!duree) return;
  const [h, m] = hdebut.value.split(':').map(Number);
  const totalMin = h * 60 + m + duree + 30;
  const fh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
  const fm = String(totalMin % 60).padStart(2, '0');
  hfin.value = `${fh}:${fm}`;
}

// ═══════════════════════════════════════════════════════════════
// PRESTATIONS
// ═══════════════════════════════════════════════════════════════

function ajouterPrestation() {
  const date = document.getElementById('p-date').value;
  const animal = document.getElementById('p-animal').value;
  const client = document.getElementById('p-client').value;
  const prestation = document.getElementById('p-prestation').value;
  const montant = parseFloat(document.getElementById('p-montant').value);

  const hdebut  = document.getElementById('p-hdebut').value;
  const hfin    = document.getElementById('p-hfin').value;

  if (!date || !animal || !prestation || isNaN(montant) || !hdebut || !hfin) {
    showAlert('alert-prestations', 'Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  const mois = getMoisFromDate(date);
  const hdebut2 = document.getElementById('p-hdebut2').value;
  const hfin2   = document.getElementById('p-hfin2').value;
  state.prestations.push({ id:uid(), date, mois, animal, client, prestation, montant, statut:'Dû', facture: null, hdebut, hfin, hdebut2, hfin2 });
  state.prestations.sort((a,b) => a.date.localeCompare(b.date));
  saveState();
  syncEventsPush();
  renderPrestations();
  renderPlanning();
  showAlert('alert-prestations', 'Prestation ajoutée.', 'success');
  document.getElementById('p-date').value = '';
  document.getElementById('p-hdebut').value = '';
  document.getElementById('p-hfin').value = '';
  document.getElementById('p-hdebut2').value = '';
  document.getElementById('p-hfin2').value = '';
}

function ajouterLot() {
  const animal = document.getElementById('lot-animal').value;
  const client = document.getElementById('lot-client').value;
  const prestation = document.getElementById('lot-prestation').value;
  const montant = parseFloat(document.getElementById('lot-montant').value);
  const debut = document.getElementById('lot-debut').value;
  const fin = document.getElementById('lot-fin').value;
  const hdebut = document.getElementById('lot-hdebut').value;
  const hfin   = document.getElementById('lot-hfin').value;

  if (!animal || !prestation || isNaN(montant) || !debut || !fin || !hdebut || !hfin) {
    showAlert('alert-prestations', 'Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  const joursOk = [0,1,2,3,4,5,6].map(d => document.getElementById('day-'+d).checked);
  if (!joursOk.some(Boolean)) {
    showAlert('alert-prestations', 'Cochez au moins un jour de la semaine.', 'error');
    return;
  }

  const hdebut2 = document.getElementById('lot-hdebut2').value;
  const hfin2   = document.getElementById('lot-hfin2').value;

  let count = 0;
  let d = new Date(debut);
  const dFin = new Date(fin);
  while (d <= dFin) {
    if (joursOk[d.getDay()]) {
      const iso = dateToISO(d);
      state.prestations.push({ id:uid(), date:iso, mois:getMoisFromDate(iso), animal, client, prestation, montant, statut:'Dû', facture: null, hdebut, hfin, hdebut2, hfin2 });
      count++;
    }
    d.setDate(d.getDate() + 1);
  }

  state.prestations.sort((a,b) => a.date.localeCompare(b.date));
  saveState();
  syncEventsPush();
  renderPrestations();
  showAlert('alert-prestations', `${count} prestation(s) ajoutée(s).`, 'success');
}

function supprimerPrestation(id) {
  if (!confirm('Supprimer cette prestation ?')) return;
  state.prestations = state.prestations.filter(p => p.id !== id);
  saveState();
  syncEventsPush();
  renderPrestations();
  renderPlanning();
}

let _currentPrestationIds = [];
function supprimerPrestationsFiltrees() {
  const n = _currentPrestationIds.length;
  if (!n) return;
  if (!confirm(`Supprimer les ${n} prestation${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''} ? Cette action est irréversible.`)) return;
  state.prestations = state.prestations.filter(p => !_currentPrestationIds.includes(p.id));
  saveState();
  renderPrestations();
  renderPlanning();
}

function toggleStatutPrestation(id) {
  const p = state.prestations.find(x => x.id === id);
  if (p) { p.statut = p.statut === 'Payé' ? 'Dû' : 'Payé'; saveState(); renderPrestations(); }
}


function renderPrestations() {
  const anneeF    = document.getElementById('filter-annee-p').value;
  const moisF     = document.getElementById('filter-mois').value;
  const factureF  = document.getElementById('filter-facture-p').value;
  const faEl      = document.getElementById('filter-animal');

  let items = state.prestations.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));
  if (anneeF) items = items.filter(p => p.date && p.date.startsWith(anneeF));
  if (moisF)  items = items.filter(p => p.date && getMoisFromDate(p.date) === moisF);
  if (factureF === 'non') items = items.filter(p => !p.facture);
  if (factureF === 'oui') items = items.filter(p => !!p.facture);

  // Mettre à jour le filtre animal selon les prestations visibles
  const animauxDispo = [...new Set(items.map(p => p.animal).filter(Boolean))].sort();
  const curAnimal = faEl.value;
  faEl.innerHTML = '<option value="">Animal</option>' +
    animauxDispo.map(a => `<option${a === curAnimal ? ' selected' : ''}>${a}</option>`).join('');
  const animalF = faEl.value;

  if (animalF) items = items.filter(p => p.animal === animalF);

  const tbody = document.getElementById('tbody-prestations');
  const empty = document.getElementById('empty-prestations');

  const thDel = document.getElementById('th-delete-presta');
  const tfoot  = document.getElementById('tfoot-prestations');

  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    thDel.innerHTML = '';
    tfoot.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  _currentPrestationIds = items.map(p => p.id);
  thDel.innerHTML = `<button class="btn-icon btn-danger-icon" title="Supprimer les prestations affichées" onclick="supprimerPrestationsFiltrees()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>`;

  const total = items.reduce((s, p) => s + (p.montant || 0), 0);
  tfoot.innerHTML = `<tr><td colspan="4" style="text-align:right;font-weight:600;padding-right:8px">Total</td><td><strong>${total % 1 === 0 ? total : total.toFixed(2)}€</strong></td><td></td><td></td></tr>`;

  tbody.innerHTML = items.map(p => {
    const factureBadge = p.facture
      ? `<span style="background:var(--accent2);color:#fff;border-radius:4px;padding:2px 7px;font-size:0.72rem;font-weight:600;white-space:nowrap">✓ ${p.facture}</span>`
      : `<span style="border:1px solid #bbb;border-radius:4px;padding:2px 7px;font-size:0.72rem;color:#999;background:transparent;white-space:nowrap">—</span>`;
    return `
    <tr>
      <td>${formatDate(p.date)}</td>
      <td><strong>${p.animal}</strong></td>
      <td style="color:#4a6355">${p.client}</td>
      <td>${p.prestation}</td>
      <td><strong>${p.montant}€</strong></td>
      <td style="text-align:center">${factureBadge}</td>
      <td>
        <button class="btn-icon btn-danger-icon" onclick="supprimerPrestation('${p.id}')" title="Supprimer"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// PLANNING
// ═══════════════════════════════════════════════════════════════

let planningTab = 'jour';
let planningDate = new Date();
let jourDate = new Date();
let bilanMode = 'annuel';

function switchPrestationsTab(tab) {
  ['indiv','lot','liste'].forEach(t => {
    document.getElementById('ptab-presta-'+t).classList.toggle('active', t === tab);
    document.getElementById('presta-vue-'+t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'liste') renderPrestations();
}

function switchFacturesTab(tab) {
  ['form','liste'].forEach(t => {
    document.getElementById('ptab-facture-'+t).classList.toggle('active', t === tab);
    document.getElementById('facture-vue-'+t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'liste') renderRecettes();
}

function switchChargesTab(tab) {
  ['form','liste'].forEach(t => {
    document.getElementById('ptab-charge-'+t).classList.toggle('active', t === tab);
    document.getElementById('charge-vue-'+t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'liste') renderDepenses();
}

function switchDonneesTab(tab) {
  ['presta','config','sauvegarde'].forEach(t => {
    document.getElementById('ptab-donnees-'+t).classList.toggle('active', t === tab);
    document.getElementById('donnees-vue-'+t).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'presta') renderDonnees();
  if (tab === 'config') renderConfig();
}

function switchBilanMode(mode) {
  bilanMode = mode;
  ['annuel','trimestriel','mois'].forEach(m => {
    document.getElementById('btab-'+m).classList.toggle('active', m === mode);
  });
  document.getElementById('filter-bilan-trimestre').style.display = mode === 'trimestriel' ? '' : 'none';
  document.getElementById('filter-bilan-mois').style.display      = mode === 'mois'         ? '' : 'none';
  renderBilan();
}

function switchPlanningTab(tab) {
  if (tab === 'semaine') planningDate = new Date(jourDate);
  planningTab = tab;
  document.getElementById('ptab-jour').classList.toggle('active', tab === 'jour');
  document.getElementById('ptab-semaine').classList.toggle('active', tab === 'semaine');
  document.getElementById('ptab-mois').classList.toggle('active', tab === 'mois');
  document.getElementById('planning-jour').style.display = tab === 'jour' ? '' : 'none';
  document.getElementById('planning-semaine').style.display = tab === 'semaine' ? '' : 'none';
  document.getElementById('planning-mois').style.display = tab === 'mois' ? '' : 'none';
  renderPlanning();
}

function renderPlanning() {
  if (planningTab === 'jour') renderJour();
  else if (planningTab === 'semaine') renderSemaine();
  else renderMois();
}

function ouvrirJour(iso) {
  jourDate = new Date(iso + 'T00:00:00');
  switchPlanningTab('jour');
}

// ── JOUR ──────────────────────────────────────────────────

function jourPrecedent() { jourDate.setDate(jourDate.getDate() - 1); renderJour(); }
function jourSuivant()   { jourDate.setDate(jourDate.getDate() + 1); renderJour(); }

let _lpTimer = null;
let _lpContextId = null;
function startLongPress(id) {
  _lpTimer = setTimeout(() => { _lpTimer = null; openPrestationContextMenu(id); }, 600);
}
function cancelLongPress() { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } }

function openPrestationContextMenu(id) {
  const p = state.prestations.find(x => x.id === id);
  if (!p) return;
  _lpContextId = id;
  document.getElementById('modal-action-presta-label').textContent = `${p.animal} — ${p.prestation}`;
  document.getElementById('modal-action-presta').classList.add('open');
}

function supprimerPrestationDepuisMenu() {
  closeModal('modal-action-presta');
  if (_lpContextId) supprimerPrestation(_lpContextId);
}

function ouvrirEditionPrestation() {
  closeModal('modal-action-presta');
  const p = state.prestations.find(x => x.id === _lpContextId);
  if (!p) return;

  const animaux = getAllAnimaux();
  document.getElementById('ep-animal').innerHTML = '<option value="">-- Choisir --</option>' +
    animaux.map(a => `<option${a.nom === p.animal ? ' selected' : ''}>${a.nom}</option>`).join('');
  document.getElementById('ep-client').value = p.client || '';
  document.getElementById('ep-prestation').innerHTML = '<option value="">-- Choisir --</option>' +
    state.prestationsTypes.map(t => `<option${t === p.prestation ? ' selected' : ''}>${t}</option>`).join('');
  document.getElementById('ep-montant').value = p.montant || '';
  document.getElementById('ep-date').value = p.date || '';
  document.getElementById('ep-hdebut').value = p.hdebut || '';
  document.getElementById('ep-hfin').value = p.hfin || '';
  document.getElementById('ep-hdebut2').value = p.hdebut2 || '';
  document.getElementById('ep-hfin2').value = p.hfin2 || '';
  onPrestationChange('ep');

  document.getElementById('modal-edit-presta').classList.add('open');
}

function sauvegarderEditionPrestation() {
  const p = state.prestations.find(x => x.id === _lpContextId);
  if (!p) return;

  const date = document.getElementById('ep-date').value;
  const animal = document.getElementById('ep-animal').value;
  const prestation = document.getElementById('ep-prestation').value;
  const montant = parseFloat(document.getElementById('ep-montant').value);
  const hdebut = document.getElementById('ep-hdebut').value;
  const hfin = document.getElementById('ep-hfin').value;

  if (!date || !animal || !prestation || isNaN(montant) || !hdebut || !hfin) {
    showAlert('', 'Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  p.date = date;
  p.mois = getMoisFromDate(date);
  p.animal = animal;
  p.client = document.getElementById('ep-client').value;
  p.prestation = prestation;
  p.montant = montant;
  p.hdebut = hdebut;
  p.hfin = hfin;
  p.hdebut2 = document.getElementById('ep-hdebut2').value;
  p.hfin2 = document.getElementById('ep-hfin2').value;

  state.prestations.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
  renderPrestations();
  renderPlanning();
  closeModal('modal-edit-presta');
  showAlert('', 'Prestation modifiée.', 'success');
}

let _lpEvTimer = null;
let _lpEvContextId = null;
function startLongPressEv(id) {
  _lpEvTimer = setTimeout(() => { _lpEvTimer = null; openEvenementContextMenu(id); }, 600);
}
function cancelLongPressEv() { if (_lpEvTimer) { clearTimeout(_lpEvTimer); _lpEvTimer = null; } }

function openEvenementContextMenu(id) {
  const e = (state.evenements || []).find(x => x.id === id);
  if (!e) return;
  _lpEvContextId = id;
  document.getElementById('modal-action-ev-label').textContent = e.nom;
  document.getElementById('modal-action-ev').classList.add('open');
}

function supprimerEvenementDepuisMenu() {
  closeModal('modal-action-ev');
  if (_lpEvContextId) supprimerEvenement(_lpEvContextId);
}

function ouvrirEditionEvenement() {
  closeModal('modal-action-ev');
  const e = (state.evenements || []).find(x => x.id === _lpEvContextId);
  if (!e) return;

  document.getElementById('ee-nom').value = e.nom;
  document.querySelector(`input[name="ee-type"][value="${e.type}"]`).checked = true;
  updateEvEditForm();

  if (e.type === 'heure' || e.type === 'journee') {
    document.getElementById('ee-date').value = e.date || '';
    document.getElementById('ee-hdebut').value = e.heureDebut || '';
    document.getElementById('ee-hfin').value = e.heureFin || '';
  } else {
    document.getElementById('ee-datedebut').value = e.dateDebut || '';
    document.getElementById('ee-datefin').value = e.dateFin || '';
    const d1 = e.dateDebut ? new Date(e.dateDebut).toLocaleDateString('fr-FR') : '';
    const d2 = e.dateFin ? new Date(e.dateFin).toLocaleDateString('fr-FR') : '';
    document.getElementById('ee-drp-btn').textContent = d1 && d2 ? `${d1} → ${d2}` : 'Sélectionner les dates';
  }

  document.getElementById('modal-edit-ev').classList.add('open');
}

function updateEvEditForm() {
  const type = document.querySelector('input[name="ee-type"]:checked').value;
  document.getElementById('ee-grp-date').style.display    = (type === 'heure' || type === 'journee') ? '' : 'none';
  document.getElementById('ee-grp-hdebut').style.display  = type === 'heure' ? '' : 'none';
  document.getElementById('ee-grp-hfin').style.display    = type === 'heure' ? '' : 'none';
  document.getElementById('ee-grp-periode').style.display = type === 'periode' ? '' : 'none';
}

function autoFillHeureFinEvEdit() {
  const hdebut = document.getElementById('ee-hdebut');
  const hfin   = document.getElementById('ee-hfin');
  if (!hdebut.value) return;
  const [h, m] = hdebut.value.split(':').map(Number);
  const total = h * 60 + m + 60;
  hfin.value = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

function sauvegarderEditionEvenement() {
  const e = (state.evenements || []).find(x => x.id === _lpEvContextId);
  if (!e) return;

  const nom = document.getElementById('ee-nom').value.trim();
  if (!nom) { showAlert('', 'Entrez un nom pour l\'événement.', 'error'); return; }
  const type = document.querySelector('input[name="ee-type"]:checked').value;

  e.nom  = nom;
  e.type = type;
  delete e.date; delete e.heureDebut; delete e.heureFin; delete e.dateDebut; delete e.dateFin;

  if (type === 'heure' || type === 'journee') {
    const date = document.getElementById('ee-date').value;
    if (!date) { showAlert('', 'Sélectionnez une date.', 'error'); return; }
    e.date = date;
    if (type === 'heure') {
      e.heureDebut = document.getElementById('ee-hdebut').value;
      e.heureFin   = document.getElementById('ee-hfin').value;
    }
  } else {
    const dateDebut = document.getElementById('ee-datedebut').value;
    const dateFin   = document.getElementById('ee-datefin').value;
    if (!dateDebut || !dateFin) { showAlert('', 'Sélectionnez une période.', 'error'); return; }
    e.dateDebut = dateDebut;
    e.dateFin   = dateFin;
  }

  saveState();
  syncEventsPush();
  renderPlanning();
  closeModal('modal-edit-ev');
  showAlert('', 'Événement modifié.', 'success');
}

function renderJour() {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(jourDate); d.setHours(0,0,0,0);
  const iso = dateToISO(d);
  const isToday = d.getTime() === today.getTime();

  const opts = {weekday:'long', day:'numeric', month:'long', year:'numeric'};
  const labelJour = d.toLocaleDateString('fr-FR', opts);
  document.getElementById('label-jour').textContent = labelJour.charAt(0).toUpperCase() + labelJour.slice(1);

  const H_START = 7, H_END = 23;
  const SLOT_H = 52;
  const prestsJour = state.prestations.filter(p => p.date === iso);
  const caJour = prestsJour.reduce((s, p) => s + (p.montant || 0), 0);
  const caEl = document.getElementById('label-ca-jour');
  if (caEl) caEl.textContent = caJour > 0 ? `CA : ${caJour.toFixed(2).replace('.', ',')} €` : '';
  const prests = expandPrestations(prestsJour);
  const evPerso = eventsForDate(iso);
  const evPersoAllDay = evPerso.filter(e => e.type === 'journee' || e.type === 'periode');
  const evPersoTimed = evPerso.filter(e => e.type === 'heure');

  // Prestations sans heure
  const sansTps = prests.filter(p => !p.hdebut);
  let html = '';
  if (sansTps.length) {
    const colors = ['#2d5a3d','#3d7a55','#1e3d2a','#4a8c5c','#5a6e3d'];
    html += `<div class="gs-hour" style="height:auto;background:var(--surface)"></div>
    <div class="gj-cell" style="height:auto;padding:4px 6px;display:flex;flex-wrap:wrap;gap:4px;border-left:1px solid var(--border);border-top:1px solid var(--border)">
      ${sansTps.map(p => {
        const ci = Math.abs(p.animal.charCodeAt(0)) % colors.length;
        return `<div class="gj-event" data-id="${p.id}" style="position:relative;left:0;right:0;background:${colors[ci]}" ontouchstart="startLongPress('${p.id}')" ontouchend="cancelLongPress()" ontouchmove="cancelLongPress()" oncontextmenu="openPrestationContextMenu('${p.id}');return false;">${p.animal} — ${p.prestation}</div>`;
      }).join('')}
    </div>`;
  }

  // Calcul global des colonnes (gère les chevauchements multi-heures)
  const _pMin = t => { if (!t) return null; const [hh,mm] = t.split(':').map(Number); return hh*60+mm; };
  const allTimed = [
    ...prests.filter(p => p.hdebut).map(p => ({
      _kind:'presta', _ref:p,
      _start:_pMin(p.hdebut), _end:_pMin(p.hfin)||(_pMin(p.hdebut)+60)
    })),
    ...evPersoTimed.map(e => ({
      _kind:'perso', _ref:e,
      _start:_pMin(e.heureDebut), _end:_pMin(e.heureFin)||(_pMin(e.heureDebut)+60)
    })),
  ];
  allTimed.sort((a,b) => a._start - b._start);
  const colEndsJ = [];
  allTimed.forEach(evt => {
    let placed = false;
    for (let i = 0; i < colEndsJ.length; i++) {
      if (colEndsJ[i] <= evt._start) { evt._col=i; colEndsJ[i]=evt._end; placed=true; break; }
    }
    if (!placed) { evt._col=colEndsJ.length; colEndsJ.push(evt._end); }
  });
  allTimed.forEach(evt => {
    let maxCol = 0;
    allTimed.forEach(o => { if (o._start < evt._end && o._end > evt._start) maxCol=Math.max(maxCol,o._col+1); });
    evt._numCols = maxCol || 1;
  });

  const gjColors = ['#2d5a3d','#3d7a55','#1e3d2a','#4a8c5c','#5a6e3d'];
  for (let h = H_START; h < H_END; h++) {
    const hEvents = allTimed.filter(evt => Math.floor(evt._start/60) === h);
    let evtHtml = '';
    hEvents.forEach(evt => {
      const startMin = evt._start % 60;
      const topPct = (startMin / 60) * 100;
      const durMin = evt._end - evt._start;
      const heightPx = durMin > 0 ? Math.max(18, (durMin/60)*SLOT_H) : SLOT_H;
      const colW = 100 / evt._numCols;
      const colL = evt._col * colW;
      const posStyle = evt._numCols > 1 ? `left:calc(${colL}% + 1px);width:calc(${colW}% - 2px);right:auto;` : '';
      if (evt._kind === 'presta') {
        const p = evt._ref;
        const ci = Math.abs(p.animal.charCodeAt(0)) % gjColors.length;
        evtHtml += `<div class="gj-event" data-id="${p.id}" title="${p.animal} — ${p.prestation} (${p.montant}€)" style="top:${topPct}%;height:${heightPx}px;background:${gjColors[ci]};${posStyle}" ontouchstart="startLongPress('${p.id}')" ontouchend="cancelLongPress()" ontouchmove="cancelLongPress()" oncontextmenu="openPrestationContextMenu('${p.id}');return false;">
          ${p.animal} — ${p.prestation}
        </div>`;
      } else {
        const e = evt._ref;
        evtHtml += `<div class="gj-event" data-id="${e.id}" style="top:${topPct}%;height:${heightPx}px;background:#D4BC9E;${posStyle}" ontouchstart="startLongPressEv('${e.id}')" ontouchend="cancelLongPressEv()" ontouchmove="cancelLongPressEv()" oncontextmenu="openEvenementContextMenu('${e.id}');return false;">
          ${e.nom}
        </div>`;
      }
    });
    html += `<div class="gs-hour gj-hour">${h === H_START ? '' : `<span>${h}h</span>`}</div>
    <div class="gj-cell${isToday?' today':''}${h%2===1?' half':''}">${evtHtml}</div>`;
  }

  // Overlays pleine hauteur pour événements journée/période
  if (evPersoAllDay.length) {
    html += evPersoAllDay.map(e =>
      `<div class="gj-period-overlay"><span class="gj-period-label" ontouchstart="startLongPressEv('${e.id}')" ontouchend="cancelLongPressEv()" ontouchmove="cancelLongPressEv()" oncontextmenu="openEvenementContextMenu('${e.id}');return false;">${e.nom}</span></div>`
    ).join('');
  }

  document.getElementById('grille-jour').innerHTML = html;
}

// Expand forfait prestations (hdebut2) en deux événements pour le planning
function expandPrestations(prests) {
  const result = [];
  prests.forEach(p => {
    result.push(p);
    if (p.hdebut2) {
      result.push(Object.assign({}, p, { hdebut: p.hdebut2, hfin: p.hfin2 || '', _forfaitSlot2: true }));
    }
  });
  return result;
}
// ── SEMAINE ──────────────────────────────────────────────────

function getLundi(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0,0,0,0);
  return dt;
}

function semainePrecedente() { planningDate.setDate(planningDate.getDate() - 7); renderSemaine(); }
function semaineSuivante()   { planningDate.setDate(planningDate.getDate() + 7); renderSemaine(); }

function renderSemaine() {
  const lundi = getLundi(planningDate);
  const jours = Array.from({length:7}, (_,i) => {
    const d = new Date(lundi);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = new Date();
  today.setHours(0,0,0,0);

  // Label
  const opts = {day:'numeric', month:'short'};
  const dim = jours[6];
  document.getElementById('label-semaine').textContent =
    `${lundi.toLocaleDateString('fr-FR',opts)} — ${dim.toLocaleDateString('fr-FR',opts)} ${dim.getFullYear()}`;

  // Heures à afficher : 7h → 21h
  const H_START = 7, H_END = 23;
  const SLOT_H = 28; // px par heure

  // Prestations de la semaine
  const isoJours = jours.map(d => dateToISO(d));
  const prests = expandPrestations(state.prestations.filter(p => isoJours.includes(p.date)));
  const evPersoByDay = {};
  isoJours.forEach(iso => { evPersoByDay[iso] = eventsForDate(iso); });

  // Construire la grille
  let html = '';

  // En-têtes
  html += '<div class="gs-header corner"></div>';
  jours.forEach((d,i) => {
    const isToday = d.getTime() === today.getTime();
    const nom = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'][i];
    const iso = isoJours[i];
    html += `<div class="gs-header">
      <div class="gs-day-header" onclick="ouvrirJour('${iso}')" style="cursor:pointer">
        <span class="day-num${isToday?' today-num':''}">${d.getDate()}</span>
        ${nom}
      </div>
    </div>`;
  });

  // Calcul global des colonnes par jour (gère les chevauchements multi-heures)
  const _pMinS = t => { if (!t) return null; const [hh,mm] = t.split(':').map(Number); return hh*60+mm; };
  const allTimedByDay = {};
  isoJours.forEach(iso => {
    const dayPrests = prests.filter(p => p.date === iso && p.hdebut);
    const dayPerso = evPersoByDay[iso].filter(e => e.type === 'heure' && e.heureDebut);
    const allTimed = [
      ...dayPrests.map(p => ({ _kind:'presta', _ref:p, _start:_pMinS(p.hdebut), _end:_pMinS(p.hfin)||(_pMinS(p.hdebut)+60) })),
      ...dayPerso.map(e => ({ _kind:'perso', _ref:e, _start:_pMinS(e.heureDebut), _end:_pMinS(e.heureFin)||(_pMinS(e.heureDebut)+60) })),
    ];
    allTimed.sort((a,b) => a._start - b._start);
    const colEnds = [];
    allTimed.forEach(evt => {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= evt._start) { evt._col=i; colEnds[i]=evt._end; placed=true; break; }
      }
      if (!placed) { evt._col=colEnds.length; colEnds.push(evt._end); }
    });
    allTimed.forEach(evt => {
      let maxCol = 0;
      allTimed.forEach(o => { if (o._start < evt._end && o._end > evt._start) maxCol=Math.max(maxCol,o._col+1); });
      evt._numCols = maxCol || 1;
    });
    allTimedByDay[iso] = allTimed;
  });

  const gsColors = ['#2d5a3d','#3d7a55','#1e3d2a','#4a8c5c','#5a6e3d'];
  // Lignes heures
  for (let h = H_START; h < H_END; h++) {
    html += `<div class="gs-hour gj-hour">${h === H_START ? '' : `<span>${h}h</span>`}</div>`;
    jours.forEach((d,di) => {
      const isToday = d.getTime() === today.getTime();
      const iso = isoJours[di];
      const hEvents = allTimedByDay[iso].filter(evt => Math.floor(evt._start/60) === h);
      let evtHtml = '';
      hEvents.forEach(evt => {
        const startMin = evt._start % 60;
        const topPct = (startMin / 60) * 100;
        const durMin = evt._end - evt._start;
        const heightPx = durMin > 0 ? Math.max(14, (durMin/60)*SLOT_H) : SLOT_H;
        const colW = 100 / evt._numCols;
        const colL = evt._col * colW;
        const posStyle = evt._numCols > 1 ? `left:calc(${colL}% + 1px);width:calc(${colW}% - 2px);right:auto;` : '';
        if (evt._kind === 'presta') {
          const p = evt._ref;
          const ci = Math.abs(p.animal.charCodeAt(0)) % gsColors.length;
          evtHtml += `<div class="gs-event" title="${p.animal} — ${p.prestation}" style="top:${topPct}%;height:${heightPx}px;background:${gsColors[ci]};${posStyle}">
            ${p.animal}
          </div>`;
        } else {
          const e = evt._ref;
          evtHtml += `<div class="gs-event" title="${e.nom}" style="top:${topPct}%;height:${heightPx}px;background:#D4BC9E;${posStyle}" ontouchstart="startLongPressEv('${e.id}')" ontouchend="cancelLongPressEv()" ontouchmove="cancelLongPressEv()" oncontextmenu="openEvenementContextMenu('${e.id}');return false;">
            ${e.nom}
          </div>`;
        }
      });
      html += `<div class="gs-cell${isToday?' today':''}${h%2===1?' half':''}" style="position:relative">${evtHtml}</div>`;
    });
  }

  // Overlays pleine hauteur pour événements journée/période
  isoJours.forEach((iso, i) => {
    const dayAllDay = evPersoByDay[iso].filter(e => e.type === 'journee' || e.type === 'periode');
    dayAllDay.forEach(e => {
      html += `<div class="gs-period-overlay" style="left:calc(48px + ${i} * (100% - 48px) / 7);right:calc(${6-i} * (100% - 48px) / 7)"><span class="gs-period-label" ontouchstart="startLongPressEv('${e.id}')" ontouchend="cancelLongPressEv()" ontouchmove="cancelLongPressEv()" oncontextmenu="openEvenementContextMenu('${e.id}');return false;">${e.nom}</span></div>`;
    });
  });

  document.getElementById('grille-semaine').innerHTML = html;
}

// ── MOIS ─────────────────────────────────────────────────────

function moisPrecedent() { planningDate.setMonth(planningDate.getMonth() - 1); renderMois(); }
function moisSuivant()   { planningDate.setMonth(planningDate.getMonth() + 1); renderMois(); }

function renderMois() {
  const year  = planningDate.getFullYear();
  const month = planningDate.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);

  document.getElementById('label-mois').textContent =
    new Date(year, month, 1).toLocaleDateString('fr-FR', {month:'long', year:'numeric'});

  // Premier jour du mois et dernier
  const premier = new Date(year, month, 1);
  const dernier = new Date(year, month+1, 0);

  // Démarrer au lundi précédent (ou le 1er si c'est un lundi)
  const startDay = getLundi(premier);
  // Finir au dimanche suivant
  const endDay = new Date(dernier);
  const dow = endDay.getDay();
  if (dow !== 0) endDay.setDate(endDay.getDate() + (7 - dow));

  // En-tête jours
  let html = '<div class="gm-header-row">';
  ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].forEach(j => {
    html += `<div class="gm-day-name">${j}</div>`;
  });
  html += '</div><div class="gm-grid">';

  const colors = ['#2d5a3d','#3d7a55','#1e3d2a','#4a8c5c','#5a6e3d','#7a9e7e','#3a6b4a'];

  let d = new Date(startDay);
  while (d <= endDay) {
    const iso = dateToISO(d);
    const isThisMonth = d.getMonth() === month;
    const isToday = d.getTime() === today.getTime();
    const dayPrests = expandPrestations(state.prestations.filter(p => p.date === iso));
    const dayEvPerso = eventsForDate(iso);

    let cellClass = 'gm-cell';
    if (!isThisMonth) cellClass += ' other-month';
    if (isToday) cellClass += ' today-cell';

    let eventsHtml = '';
    const MAX_VISIBLE = 3;
    const totalItems = dayPrests.length + dayEvPerso.length;
    let shown = 0;
    dayEvPerso.slice(0, MAX_VISIBLE).forEach(e => {
      eventsHtml += `<div class="gm-event" title="${e.nom}" style="background:#D4BC9E">${e.nom}</div>`;
      shown++;
    });
    dayPrests.slice(0, MAX_VISIBLE - shown).forEach(p => {
      const ci = Math.abs((p.animal||'').charCodeAt(0)) % colors.length;
      eventsHtml += `<div class="gm-event" title="${p.animal} — ${p.prestation}${p.hdebut?' — '+p.hdebut+(p.hfin?' → '+p.hfin:''):''}" style="background:${colors[ci]}">${p.animal}</div>`;
      shown++;
    });
    if (totalItems > MAX_VISIBLE) {
      eventsHtml += `<div class="gm-more">+${totalItems - MAX_VISIBLE} autre(s)</div>`;
    }

    const clickAttr = isThisMonth ? ` onclick="ouvrirJour('${iso}')" style="cursor:pointer"` : '';
    html += `<div class="${cellClass}"${clickAttr}>
      <span class="gm-date${isToday?' today-date':''}">${d.getDate()}</span>
      ${eventsHtml}
    </div>`;

    d.setDate(d.getDate() + 1);
  }
  html += '</div>';
  document.getElementById('grille-mois').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// RECETTES
// ═══════════════════════════════════════════════════════════════

let lastFactureData = null;

function getNextRef() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const usedNums = new Set(
    state.recettes
      .map(r => r.ref ? parseInt(r.ref.split('-')[1], 10) : null)
      .filter(n => n !== null && !isNaN(n))
  );
  let num = 1;
  while (usedNums.has(num)) num++;
  return `${yy}${mm}-${String(num).padStart(4,'0')}`;
}

function onRistourneChange() {
  const type = document.getElementById('r-ristourne-type').value;
  const wrap  = document.getElementById('r-ristourne-val-wrap');
  const label = document.getElementById('r-ristourne-val-label');
  wrap.style.display = type ? '' : 'none';
  label.textContent  = type === 'pct' ? 'Remise (%)' : 'Remise (€)';
  resetFactureForm();
}

function calcTotalNet(totalBrut, ristourneType, ristourneVal) {
  if (ristourneType === 'pct'    && ristourneVal > 0) return Math.max(0, totalBrut * (1 - ristourneVal / 100));
  if (ristourneType === 'montant' && ristourneVal > 0) return Math.max(0, totalBrut - ristourneVal);
  return totalBrut;
}

function onDocTypeChange() {
  const isDevis = document.getElementById('r-doc-type-devis').checked;
  document.getElementById('r-doc-type-facture-label').style.background = isDevis ? 'transparent' : 'var(--accent)';
  document.getElementById('r-doc-type-facture-label').style.color = isDevis ? 'var(--text2)' : '#fff';
  document.getElementById('r-doc-type-devis-label').style.background = isDevis ? 'var(--accent)' : 'transparent';
  document.getElementById('r-doc-type-devis-label').style.color = isDevis ? '#fff' : 'var(--text2)';
  resetFactureForm();
}

function onMois1Change() {
  resetFactureForm();
  if (document.getElementById('r-multi-mois').checked) autoFillMois2();
}

function onMultiMoisChange() {
  const checked = document.getElementById('r-multi-mois').checked;
  document.getElementById('r-mois2-wrap').style.display = checked ? '' : 'none';
  if (checked) autoFillMois2();
  resetFactureForm();
}

function autoFillMois2() {
  const mois1 = document.getElementById('r-mois').value;
  if (!mois1) return;
  const nextIdx = (MOIS_LIST.indexOf(mois1) + 1) % 12;
  const sel2 = document.getElementById('r-mois2');
  if (sel2) sel2.value = MOIS_LIST[nextIdx];
}

function previewFacture() {
  const proprio = document.getElementById('r-client').value;
  const mois = document.getElementById('r-mois').value;
  const annee = document.getElementById('r-annee').value;
  const multiMois = document.getElementById('r-multi-mois').checked;
  const mois2 = multiMois ? document.getElementById('r-mois2').value : null;

  if (!proprio || !mois || !annee) {
    showAlert('alert-recettes-form', 'Choisissez un propriétaire, un mois et une année.', 'error');
    return;
  }
  if (multiMois && !mois2) {
    showAlert('alert-recettes-form', 'Choisissez le 2ème mois.', 'error');
    return;
  }

  // Si le 2ème mois est avant le 1er (ex: déc → jan), l'année avance
  const annee2 = mois2 && MOIS_LIST.indexOf(mois2) < MOIS_LIST.indexOf(mois)
    ? String(parseInt(annee) + 1) : annee;

  let prestsMois = state.prestations.filter(p =>
    p.client.toLowerCase() === proprio.toLowerCase() &&
    p.date && p.date.startsWith(annee) &&
    getMoisFromDate(p.date) === mois &&
    !p.facture
  );
  if (mois2) {
    prestsMois = [...prestsMois, ...state.prestations.filter(p =>
      p.client.toLowerCase() === proprio.toLowerCase() &&
      p.date && p.date.startsWith(annee2) &&
      getMoisFromDate(p.date) === mois2 &&
      !p.facture
    )];
  }

  if (prestsMois.length === 0) {
    const periode = mois2 ? `${mois} – ${mois2} ${annee2 !== annee ? annee+'/'+annee2 : annee}` : `${mois} ${annee}`;
    showAlert('alert-recettes-form', `Aucune prestation trouvée pour ${proprio} en ${periode}.`, 'error');
    document.getElementById('r-preview').style.display = 'none';
    return;
  }

  const totalBrut = prestsMois.reduce((s,p) => s + p.montant, 0);
  const animauxConcernes = [...new Set(prestsMois.map(p => p.animal))];
  const ref = getNextRef();
  const dateFacture = new Date();
  const ristourneType = document.getElementById('r-ristourne-type').value;
  const ristourneVal  = parseFloat(document.getElementById('r-ristourne-val').value) || 0;
  const totalNet = calcTotalNet(totalBrut, ristourneType, ristourneVal);
  const periodeLabel = mois2
    ? `${mois} – ${mois2} ${annee2 !== annee ? annee+'/'+annee2 : annee}`
    : `${mois} ${annee}`;

  lastFactureData = { proprio, mois, annee, mois2: mois2||null, annee2: mois2?annee2:null, prestsMois, total: totalBrut, totalNet, ristourneType, ristourneVal, ref, dateFacture, animauxConcernes, periodeLabel };

  const remiseLigne = ristourneType && ristourneVal > 0
    ? `<div><strong>Remise :</strong> ${ristourneType === 'pct' ? ristourneVal + '%' : ristourneVal + '€'}</div>
       <div><strong>Total après remise :</strong> <span style="color:var(--accent2);font-weight:700">${totalNet.toFixed(2)}€</span></div>`
    : '';

  document.getElementById('r-preview-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem">
      <div><strong>Référence :</strong> ${ref}</div>
      <div><strong>Date :</strong> ${formatDate(dateFacture)}</div>
      <div><strong>Propriétaire :</strong> ${proprio}</div>
      <div><strong>Période :</strong> ${periodeLabel}</div>
      <div><strong>Animaux :</strong> ${animauxConcernes.join(', ')}</div>
      <div><strong>Total HT :</strong> ${ristourneType && ristourneVal > 0 ? totalBrut.toFixed(2) + '€' : `<span style="color:var(--accent2);font-weight:700">${totalBrut.toFixed(2)}€</span>`}</div>
      ${remiseLigne}
    </div>
  `;
  document.getElementById('r-preview').style.display = 'block';
}

function onBtnCreer() {
  const isDevis = document.getElementById('r-doc-type-devis').checked;
  if (!lastFactureData) {
    previewFacture();
    if (lastFactureData) {
      const btn = document.getElementById('btn-creer');
      btn.textContent = isDevis ? 'Créer le devis' : 'Créer la facture';
      btn.className = 'btn btn-primary';
    }
  } else {
    if (isDevis) genererDevis();
    else genererFacture();
  }
}

async function genererDevis() {
  if (!lastFactureData) return;
  const { proprio, periodeLabel, prestsMois, total, ristourneType, ristourneVal, dateFacture } = lastFactureData;
  const clientData = state.clients.find(c => c.nom === proprio);
  const adresseLines = clientData ? [clientData.adresse, [clientData.cp, clientData.ville].filter(Boolean).join(' ')].filter(Boolean) : [];
  const d = new Date();
  const devisRef = 'D-' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  await _buildPDF(devisRef, proprio, adresseLines, periodeLabel, dateFacture, prestsMois, total, clientData?.mode || 'Liquide', ristourneType || '', ristourneVal || 0, 'DEVIS');
  resetFactureForm();
}

function resetFactureForm() {
  lastFactureData = null;
  const btn = document.getElementById('btn-creer');
  if (btn) { btn.textContent = 'Aperçu'; btn.className = 'btn btn-secondary'; }
  const preview = document.getElementById('r-preview');
  if (preview) preview.style.display = 'none';
}

function genererFacture() {
  const { proprio, mois, annee, mois2, annee2, total, totalNet, ristourneType, ristourneVal, ref, dateFacture, prestsMois } = lastFactureData;

  const clientData = state.clients.find(c => c.nom === proprio);
  const mode = clientData ? clientData.mode : 'Liquide';

  const moisNum = String(MOIS_LIST.indexOf(mois) + 1).padStart(2, '0');
  const yearMoisCle = `${annee}-${moisNum}`;

  let moisCle2 = null;
  if (mois2) {
    const moisNum2 = String(MOIS_LIST.indexOf(mois2) + 1).padStart(2, '0');
    moisCle2 = `${annee2}-${moisNum2}`;
  }

  const dateISO = dateToISO(dateFacture);
  state.recettes.push({
    id: uid(), ref, client: proprio, date: dateISO, moisCle: yearMoisCle,
    ...(moisCle2 ? { moisCle2 } : {}),
    montant: totalNet ?? total, montantBrut: total,
    ristourneType: ristourneType || '', ristourneVal: ristourneVal || 0,
    mode, statut: 'Dû'
  });
  prestsMois.forEach(pm => {
    const sp = state.prestations.find(x => x.id === pm.id);
    if (sp) sp.facture = ref;
  });
  saveState();
  exportBackup();
  renderRecettes();
  showAlert('alert-recettes-form', 'Facture créée.', 'success');
  resetFactureForm();
}

function toggleStatutRecette(id) {
  const r = state.recettes.find(x => x.id === id);
  if (!r) return;
  if (r.statut === 'Payé') {
    r.statut = 'Dû';
    r.datePaiement = null;
  } else {
    r.statut = 'Payé';
    r.datePaiement = dateToISO(new Date());
  }
  saveState(); renderRecettes();
}

function getPrestsForRecette(r) {
  function prestsForCle(moisCle) {
    const annee = moisCle.slice(0, 4);
    const moisNom = MOIS_LIST[parseInt(moisCle.slice(5, 7)) - 1];
    return state.prestations.filter(p =>
      p.client.toLowerCase() === r.client.toLowerCase() &&
      p.date && p.date.startsWith(annee) &&
      getMoisFromDate(p.date) === moisNom
    );
  }
  let prests;
  if (r.moisCle) {
    prests = prestsForCle(r.moisCle);
  } else {
    const annee = r.date ? r.date.slice(0, 4) : '';
    const moisNom = r.date ? getMoisFromDate(r.date) : '';
    prests = state.prestations.filter(p =>
      p.client.toLowerCase() === r.client.toLowerCase() &&
      p.date && p.date.startsWith(annee) &&
      getMoisFromDate(p.date) === moisNom
    );
  }
  if (r.moisCle2) prests = [...prests, ...prestsForCle(r.moisCle2)];
  return prests;
}

function getTypePrestation(prests) {
  const types = new Set();
  prests.forEach(p => {
    const n = (p.prestation || '').toLowerCase();
    if (n.includes('balade') || n.includes('promenade')) types.add('Promenade de chien');
    else if (n.includes('visite')) types.add('Visite à domicile');
    else if (n.includes('garde')) types.add('Garde à domicile');
  });
  return types.size ? [...types].join(' / ') : '—';
}

function renderRecettes() {
  const anneeF = document.getElementById('filter-annee-r').value;
  const moisF  = document.getElementById('filter-mois-r').value;
  const fcEl   = document.getElementById('filter-client-r');

  const statutF = (document.getElementById('filter-statut-r')||{}).value || '';

  let items = state.recettes.slice().sort((a,b) => (b.ref||'').localeCompare(a.ref||'', undefined, { numeric: true }));
  if (anneeF)  items = items.filter(r => r.date && r.date.startsWith(anneeF));
  if (moisF)   items = items.filter(r => r.date && getMoisFromDate(r.date) === moisF);
  if (statutF) items = items.filter(r => r.statut === statutF);

  // Mettre à jour le filtre client selon les factures visibles
  const clientsDispo = [...new Set(items.map(r => r.client).filter(Boolean))].sort();
  const curClient = fcEl.value;
  fcEl.innerHTML = '<option value="">Client</option>' +
    clientsDispo.map(c => `<option${c === curClient ? ' selected' : ''}>${c}</option>`).join('');
  const clientF = fcEl.value;

  if (clientF) items = items.filter(r => r.client === clientF);

  const tbody = document.getElementById('tbody-recettes');
  const empty = document.getElementById('empty-recettes');

  const tfoot = document.getElementById('tfoot-recettes');

  if (items.length === 0) {
    tbody.innerHTML = ''; tfoot.innerHTML = ''; empty.style.display = 'block'; return;
  }
  empty.style.display = 'none';

  const total = items.reduce((s, r) => s + (r.montant || 0), 0);
  tfoot.innerHTML = `<tr><td colspan="5" style="text-align:right;font-weight:600;padding-right:8px">Total</td><td><strong>${total % 1 === 0 ? total : total.toFixed(2)}€</strong></td><td colspan="4"></td></tr>`;

  tbody.innerHTML = items.map(r => {
    const type = getTypePrestation(getPrestsForRecette(r));
    return `
    <tr onclick="toggleStatutRecette('${r.id}')" style="cursor:pointer">
      <td><button class="btn-icon" title="Exporter PDF" onclick="exporterFacturePDF('${r.id}');event.stopPropagation()">📄</button></td>
      <td><code style="font-size:0.8rem;background:var(--surface2);padding:2px 6px;border-radius:4px">${r.ref}</code></td>
      <td><strong>${r.client}</strong></td>
      <td style="color:var(--text2);font-size:0.82rem">${type}</td>
      <td>${formatDate(r.date)}</td>
      <td><strong>${r.montant}€</strong></td>
      <td style="color:var(--text2);font-size:0.82rem">${r.mode}</td>
      <td><span class="badge ${r.statut==='Payé'?'badge-green':'badge-red'}">${r.statut}</span></td>
      <td style="color:var(--text2);font-size:0.82rem">${r.datePaiement ? formatDate(r.datePaiement) : '—'}</td>
      <td><button class="btn-icon btn-danger-icon" onclick="supprimerRecette('${r.id}');event.stopPropagation()" title="Supprimer"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button></td>
    </tr>
  `; }).join('');
}

// ═══════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════

async function genererPDF() {
  if (!lastFactureData) return;
  const { proprio, periodeLabel, prestsMois, total, ristourneType, ristourneVal, ref, dateFacture } = lastFactureData;
  const clientData = state.clients.find(c => c.nom === proprio);
  const mode = clientData ? clientData.mode : 'Liquide';
  const adresseLines = clientData ? [clientData.adresse, [clientData.cp, clientData.ville].filter(Boolean).join(' ')].filter(Boolean) : [];
  await _buildPDF(ref, proprio, adresseLines, periodeLabel, dateFacture, prestsMois, total, mode, ristourneType || '', ristourneVal || 0);
}

async function genererPDFFromRecette(id) {
  const rec = state.recettes.find(r => r.id === id);
  if (!rec) return;
  function getMoisAnneeFromCle(moisCle) {
    return { annee: moisCle.slice(0, 4), moisNom: MOIS_LIST[parseInt(moisCle.slice(5, 7)) - 1] };
  }
  let annee, moisNom;
  if (rec.moisCle) {
    ({ annee, moisNom } = getMoisAnneeFromCle(rec.moisCle));
  } else {
    annee = rec.date.slice(0, 4);
    moisNom = getMoisFromDate(rec.date);
  }
  const prestsMois = getPrestsForRecette(rec);
  let periodeLabel = `${moisNom} ${annee}`;
  if (rec.moisCle2) {
    const { annee: annee2, moisNom: moisNom2 } = getMoisAnneeFromCle(rec.moisCle2);
    periodeLabel = `${moisNom} – ${moisNom2} ${annee2 !== annee ? annee+'/'+annee2 : annee}`;
  }
  const clientData = state.clients.find(c => c.nom === rec.client);
  const adresseLines = clientData ? [clientData.adresse, [clientData.cp, clientData.ville].filter(Boolean).join(' ')].filter(Boolean) : [];
  const totalBrut = rec.montantBrut || prestsMois.reduce((s,p) => s + p.montant, 0);
  await _buildPDF(rec.ref, rec.client, adresseLines, periodeLabel, new Date(rec.date), prestsMois, totalBrut, rec.mode, rec.ristourneType || '', rec.ristourneVal || 0);
}

async function _buildPDF(ref, client, adresse, mois, dateFacture, prestations, total, mode, ristourneType = '', ristourneVal = 0, docType = 'FACTURE') {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const W = 210, margin = 20;

  // Couleurs
  const BROWN = [30, 61, 42];
  const AMBER = [45, 90, 61];
  const GRAY = [74, 99, 85];
  const LIGHT = [232, 242, 236];
  const BLACK = [26, 46, 31];

  const LOGO_B64 = 'data:image/png;base64,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';
  // En-tête : logo + "Dardidog" via canvas (Great Vibes déjà chargée par CSS)
  const logoX = margin, logoY = 8, logoS = 15;
  try { doc.addImage(LOGO_B64, 'PNG', logoX, logoY, logoS, logoS); } catch(e) {}
  try {
    await document.fonts.load('72px "Great Vibes"');
    const scale = 6;
    const cv = document.createElement('canvas');
    const fontSize = 40;
    const cvH = 80;
    const tmpCv = document.createElement('canvas');
    const tmpCtx = tmpCv.getContext('2d');
    tmpCtx.font = `${fontSize}px "Great Vibes"`;
    const textW = Math.ceil(tmpCtx.measureText('Dardidog').width) + 30;
    cv.width = textW * scale; cv.height = cvH * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, textW, cvH);
    ctx.fillStyle = '#154734';
    ctx.font = `${fontSize}px "Great Vibes"`;
    ctx.fillText('Dardidog', 4, 62);
    const pdfW = textW * 0.27;
    const pdfH = 22;
    const textY = logoY + logoS / 2 - pdfH * 0.6;
    doc.addImage(cv.toDataURL('image/png'), 'PNG', logoX + logoS + 2, textY, pdfW, pdfH);
  } catch(e) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(22);
    doc.setTextColor(21, 71, 52);
    doc.text('Dardidog', margin + 22, 19);
  }

  // Titre FACTURE centré en vert
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(34);
  doc.setTextColor(21, 71, 52);
  doc.text(docType, W/2, 46, { align: 'center' });

  // Date + N° facture
  let y = 60;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text("DATE D'EMISSION : " + formatDate(dateFacture), margin, y);
  doc.setFont('helvetica', 'bold');
  doc.text((docType === 'DEVIS' ? 'N° DEVIS : ' : 'N° DE FACTURE : ') + ref, W - margin, y, { align: 'right' });

  // Ligne verte séparatrice sous date/ref
  y += 4;
  doc.setDrawColor(21, 71, 52);
  doc.setLineWidth(0.6);
  doc.line(margin, y, W - margin, y);

  // ÉMETTEUR / DESTINATAIRE
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text('ÉMETTEUR :', margin, y);
  doc.text('DESTINATAIRE :', W - margin, y, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const cfg = state.config || DEFAULT_CONFIG;
  const emetteurLines = [
    cfg.nom,
    cfg.statut,
    cfg.siret ? 'SIRET : ' + cfg.siret : null,
    cfg.ape   ? 'APE : '   + cfg.ape   : null,
    cfg.adresse1,
    cfg.adresse2,
  ].filter(Boolean);
  emetteurLines.forEach((line, i) => doc.text(line, margin, y + 6 + i * 5));
  doc.text(client, W - margin, y + 6, { align: 'right' });
  adresse.forEach((line, i) => doc.text(line, W - margin, y + 11 + i * 5, { align: 'right' }));

  // Tableau des prestations
  const NOTES_Y = 272;     // position fixe des notes en bas de chaque page
  const FOOTER_Y = 269;    // le règlement doit se terminer avant ici
  const TABLE_BOTTOM = 254;

  const totalNum = typeof total === 'number' ? total : parseFloat(total) || 0;
  const totalNet = calcTotalNet(totalNum, ristourneType, ristourneVal);
  const hasRemise = ristourneType && ristourneVal > 0;
  const totalsHeight = hasRemise ? 24 : 12;
  const reglementLines = [docType === 'DEVIS'
    ? 'RÈGLEMENT EN LIQUIDE, PAR CHÈQUE OU PAR VIREMENT BANCAIRE.'
    : 'RÈGLEMENT DÛ SOUS 15 JOURS EN LIQUIDE, PAR CHÈQUE OU PAR VIREMENT BANCAIRE.'];
  const sortedPrests = [...prestations].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Stratégie de mise en page : on tente d'abord l'espacement normal, puis un
  // espacement resserré (police + interlignes réduits) pour faire tenir le tout
  // sur une seule page. Au-delà d'un certain nombre de lignes de prestations
  // (moins si remise, qui ajoute des lignes de total), même resserré ce serait
  // illisible : on bascule alors le bloc totaux/règlement sur une 2e page.
  const NORMAL = { addrGap: 10, tableGap: 10, reglFont: 9, reglLine: 5 };
  const TIGHT = { addrGap: 1, tableGap: 4, reglFont: 7.5, reglLine: 3.5 };
  const MAX_LINES_SINGLE_PAGE = hasRemise ? 18 : 22;
  const n = sortedPrests.length;
  const baseY = y + 6 + emetteurLines.length * 5;
  const TABLE_HEADER_H = 8; // hauteur fixe de l'en-tête du tableau (texte + ligne)
  const fitsWith = (lay) => baseY + lay.addrGap + TABLE_HEADER_H + n * 6 + lay.tableGap
    + totalsHeight + 5 + reglementLines.length * lay.reglLine <= FOOTER_Y;

  let layout = NORMAL;
  if (n <= MAX_LINES_SINGLE_PAGE && !fitsWith(NORMAL) && fitsWith(TIGHT)) layout = TIGHT;

  y = baseY + layout.addrGap;

  function drawTableHeader() {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text('Prestations', margin, y);
    doc.text('Date', margin + 115, y);
    doc.text('Montant HT', W - margin, y, { align: 'right' });
    y += 3;
    doc.setDrawColor(30, 30, 30);
    doc.setLineWidth(0.4);
    doc.line(margin, y, W - margin, y);
    y += 5;
  }
  drawTableHeader();

  sortedPrests.forEach((p, idx) => {
    if (y + 6 > TABLE_BOTTOM) {
      doc.addPage();
      y = 20;
      drawTableHeader();
    }
    if (idx % 2 === 1) {
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, y - 3, W - 2*margin, 6, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text((p.prestation || '').substring(0, 50), margin, y + 2);
    doc.text(formatDate(p.date), margin + 115, y + 2);
    const m = typeof p.montant === 'number' ? p.montant : parseFloat(p.montant) || 0;
    doc.setFont('helvetica', 'normal');
    doc.text(m.toFixed(2) + '€', W - margin, y + 2, { align: 'right' });
    y += 6;
  });

  y += layout.tableGap;

  // Les totaux restent sur la page du tableau (cas extrême seulement : si même
  // eux ne tiennent plus, on les bascule avec le reste sur une nouvelle page)
  if (y + totalsHeight + 10 > FOOTER_Y) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);

  if (hasRemise) {
    doc.text('Montant HT :', W - margin - 22, y, { align: 'right' });
    doc.text(totalNum.toFixed(2) + ' €', W - margin, y, { align: 'right' });
    y += 6;
    const remiseLabel = ristourneType === 'pct' ? `Remise (${ristourneVal}%) :` : 'Remise :';
    const remiseMontant = ristourneType === 'pct'
      ? (totalNum * ristourneVal / 100).toFixed(2)
      : ristourneVal.toFixed(2);
    doc.setFont('helvetica', 'normal');
    doc.text(remiseLabel, W - margin - 22, y, { align: 'right' });
    doc.text('- ' + remiseMontant + ' €', W - margin, y, { align: 'right' });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Montant HT après remise :', W - margin - 22, y, { align: 'right' });
    doc.text(totalNet.toFixed(2) + ' €', W - margin, y, { align: 'right' });
    y += 6;
  } else {
    doc.text('TOTAL HT :', W - margin - 22, y, { align: 'right' });
    doc.text(totalNum.toFixed(2) + ' €', W - margin, y, { align: 'right' });
    y += 6;
  }
  doc.text('TOTAL TTC* :', W - margin - 22, y, { align: 'right' });
  doc.text(totalNet.toFixed(2) + ' €', W - margin, y, { align: 'right' });
  y += 6;

  // Règlement + note TVA : ensemble, sur la même page que les totaux si ça
  // tient, sinon les deux basculent ensemble en haut d'une nouvelle page
  // (et non plus règlement en haut / note ancrée tout en bas)
  const reglBlockHeight = 5 + reglementLines.length * layout.reglLine;
  let reglLayout = layout;
  let reglOnNewPage = false;
  if (y + reglBlockHeight > FOOTER_Y) {
    doc.addPage();
    y = 20;
    reglLayout = NORMAL; // pleine place disponible sur la nouvelle page
    reglOnNewPage = true;
  } else {
    y += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(reglLayout.reglFont);
  doc.setTextColor(30, 30, 30);
  reglementLines.forEach((line, i) => doc.text(line, margin, y + i * reglLayout.reglLine));

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  const mediationIntro = doc.splitTextToSize("Conformément aux dispositions du Code de la consommation concernant le règlement amiable des litiges, le client consommateur a la possibilité, en cas de litige non résolu avec Dardidog, de recourir gratuitement au service de médiation suivant :", W - 2 * margin);
  const mediationCoords = doc.splitTextToSize("Société Médiation Professionnelle (SMP) — Site : www.mediateur-consommation-smp.fr — Alteritae, 5 rue Salvaing, 12000 Rodez.", W - 2 * margin);
  const mLH = 4;
  const noteY = NOTES_Y; // position fixe en bas de la page courante
  doc.setTextColor(120, 120, 120);
  doc.text('*TVA non applicable, art. 293 B du code général des impôts', margin, noteY);
  doc.text(mediationIntro, margin, noteY + 8);
  doc.text(mediationCoords, margin, noteY + 8 + mediationIntro.length * mLH);

  const prefix = docType === 'DEVIS' ? 'Devis' : 'Facture';
  doc.save(`${prefix}_${ref}_${client.replace(/ /g,'_')}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// BILAN
// ═══════════════════════════════════════════════════════════════

function initBilanFilter() {
  const selAnnee = document.getElementById('filter-bilan-annee');
  if (!selAnnee) return;
  const now = new Date();
  const yearCourant = now.getFullYear();
  const allYears = [...new Set([
    ...state.recettes.map(r => r.date ? r.date.slice(0,4) : null),
    ...state.depenses.map(d => d.date ? d.date.slice(0,4) : null),
    String(yearCourant)
  ].filter(Boolean))].sort().reverse();
  const curVal = selAnnee.value || String(yearCourant);
  selAnnee.innerHTML = allYears.map(y => `<option value="${y}"${y===curVal?' selected':''}>${y}</option>`).join('');

  const selTrim = document.getElementById('filter-bilan-trimestre');
  if (selTrim) {
    const curTrim = selTrim.dataset.init ? selTrim.value : `T${Math.floor(now.getMonth() / 3) + 1}`;
    selTrim.value = curTrim;
    selTrim.dataset.init = '1';
  }

  const selMois = document.getElementById('filter-bilan-mois');
  if (selMois) {
    const defMois = MOIS_LIST[now.getMonth()];
    const allMois = MOIS_LIST.filter(m =>
      state.recettes.some(r => r.date && getMoisFromDate(r.date) === m) ||
      state.depenses.some(d => d.date && getMoisFromDate(d.date) === m)
    );
    const moisList = allMois.includes(defMois) ? allMois : [...allMois, defMois].sort((a,b) => MOIS_LIST.indexOf(a)-MOIS_LIST.indexOf(b));
    const curMois = selMois.value || defMois;
    selMois.innerHTML = moisList.map(m => `<option${m===curMois?' selected':''}>${m}</option>`).join('');
  }
}

function getBilanPeriode() {
  const year = parseInt((document.getElementById('filter-bilan-annee')||{}).value);
  if (!year) return () => true;
  if (bilanMode === 'annuel') return date => date && date.startsWith(String(year));
  if (bilanMode === 'mois') {
    const mois = (document.getElementById('filter-bilan-mois')||{}).value;
    return date => {
      if (!date) return false;
      const d = new Date(date + 'T00:00:00');
      return d.getFullYear() === year && getMoisFromDate(date) === mois;
    };
  }
  const trim = (document.getElementById('filter-bilan-trimestre')||{}).value || 'T1';
  const t = parseInt(trim.replace('T',''));
  const mStart = (t - 1) * 3;
  const mEnd   = mStart + 2;
  return date => {
    if (!date) return false;
    const d = new Date(date + 'T00:00:00');
    return d.getFullYear() === year && d.getMonth() >= mStart && d.getMonth() <= mEnd;
  };
}

function renderBilan() {
  initBilanFilter();
  const inPeriode = getBilanPeriode();

  const recettesFiltrees = state.recettes.filter(r => inPeriode(r.date));
  const chargesFiltrees  = (state.depenses || []).filter(d => inPeriode(d.date));

  const ca         = recettesFiltrees.reduce((s,r) => s + (r.montant||0), 0);
  const caEncaisse = state.recettes
    .filter(r => r.statut === 'Payé' && inPeriode(r.datePaiement || r.date))
    .reduce((s,r) => s + (r.montant||0), 0);
  const caExtraTotal = (state.caExtra || [])
    .filter(e => inPeriode(e.date))
    .reduce((s,e) => s + (e.montant||0), 0);
  const flyerNoms = new Set(state.clients.filter(c => c.flyer).map(c => c.nom));
  const caFlyers = state.recettes
    .filter(r => r.statut === 'Payé' && inPeriode(r.datePaiement || r.date) && flyerNoms.has(r.client))
    .reduce((s,r) => s + (r.montant||0), 0);
  const charges    = chargesFiltrees.filter(d => d.type !== 'Impôts').reduce((s,d) => s + (d.montant||0), 0);
  const impots     = chargesFiltrees.filter(d => d.type === 'Impôts').reduce((s,d) => s + (d.montant||0), 0);
  const benefice   = caEncaisse - charges - impots + caExtraTotal;
  const nbMois     = bilanMode === 'annuel' ? 12 : bilanMode === 'trimestriel' ? 3 : 1;
  const beneficeMois = benefice / nbMois;

  const fmt = n => n.toFixed(2).replace('.',',')+' €';
  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-val">${fmt(ca)}</div>
      <div class="stat-label">CA facturé</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${fmt(caEncaisse)}</div>
      <div class="stat-label">CA encaissé</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${fmt(impots)}</div>
      <div class="stat-label">Impôts</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${fmt(charges)}</div>
      <div class="stat-label">Dépenses</div>
    </div>
    <div class="stat-card full">
      <div class="stat-val" style="color:#2d7a4f">+${fmt(caExtraTotal)}</div>
      <div class="stat-label">Extra</div>
    </div>
    <div class="stat-card full">
      <div class="stat-val">${fmt(benefice)}</div>
      <div class="stat-label">Bénéfice net</div>
    </div>
    ${bilanMode !== 'mois' ? `
    <div class="stat-card full">
      <div class="stat-val">${fmt(beneficeMois)}</div>
      <div class="stat-label">Bénéfice net moyen / mois</div>
    </div>` : ''}
  `;
  document.getElementById('flyer-bilan').innerHTML = `
    <div class="card">
      <div class="stats-row">
        <div class="stat-card full">
          <div class="stat-val">${fmt(caFlyers)}</div>
          <div class="stat-label">Revenus générés par les flyers</div>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// CLIENTS (Propriétaire + Animaux)
// ═══════════════════════════════════════════════════════════════

function ajouterClient() {
  const nomEl = document.getElementById('c-nom');
  if (!nomEl) return; // form removed from UI
  const nom = nomEl.value.trim();
  const tel = (document.getElementById('c-tel')||{value:''}).value.trim();
  const mode = (document.getElementById('c-mode')||{value:'Liquide'}).value;
  const adresse = (document.getElementById('c-adresse')||{value:''}).value.trim();

  if (!nom) {
    showAlert('alert-clients', 'Le nom du propriétaire est obligatoire.', 'error');
    return;
  }
  if (state.clients.find(c => c.nom.toLowerCase() === nom.toLowerCase())) {
    showAlert('alert-clients', `Le propriétaire "${nom}" existe déjà.`, 'error');
    return;
  }

  state.clients.push({ id:uid(), nom, tel, adresse, mode, animaux:[] });
  saveState();
  populateSelects();
  renderClients();
  showAlert('alert-clients', `${nom} ajouté`, 'success');
  ['c-nom','c-tel','c-adresse'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function supprimerClient(id) {
  if (!confirm('Supprimer ce propriétaire et tous ses animaux ?')) return;
  state.clients = state.clients.filter(c => c.id !== id);
  saveState();
  populateSelects();
  renderClients();
  renderAnimaux();
}



function supprimerAnimal(proprioId, animalNom) {
  if (!confirm(`Supprimer l'animal "${animalNom}" ?`)) return;
  const proprio = state.clients.find(c => c.id === proprioId);
  if (!proprio) return;
  proprio.animaux = (proprio.animaux||[]).filter(a => a.nom !== animalNom);
  saveState();
  populateSelects();
  renderClients();
}

let _ficheClientRef  = null;
let _ficheClientMode = 'view';
let _animalFromClient = false;

function voirFicheClient(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;
  _ficheClientRef  = clientId;
  _ficheClientMode = 'view';
  document.getElementById('fiche-client-title').textContent = client.nom;
  document.getElementById('fiche-client-edit-btn').style.background = 'none';
  renderFicheClientView(client);
  document.getElementById('modal-fiche-client').classList.add('open');
}

function _getClient() {
  return state.clients.find(c => c.id === _ficheClientRef) || null;
}

const SVG_PENCIL = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SVG_SAVE   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

function switchFicheClientMode() {
  _ficheClientMode = _ficheClientMode === 'view' ? 'edit' : 'view';
  const client = _getClient();
  if (!client) return;
  const btn = document.getElementById('fiche-client-edit-btn');
  if (_ficheClientMode === 'edit') {
    btn.style.background = '#c8bfaf';
    btn.innerHTML = SVG_SAVE;
    renderFicheClientEdit(client);
  } else {
    btn.style.background = 'none';
    btn.innerHTML = SVG_PENCIL;
    renderFicheClientView(client);
  }
}

function renderFicheClientView(client) {
  const row = (label, v) => `
    <div style="margin-bottom:12px">
      <div style="font-size:0.67rem;color:#7a9e7e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">${label}</div>
      <div style="font-size:0.9rem;color:${v ? '#2d3b2f' : '#bbb'};font-weight:${v ? '500' : '400'}">${v || '—'}</div>
    </div>`;
  const adresseDisplay = [client.adresse, client.complement, client.cp, client.ville].filter(Boolean).join(', ') || null;
  const adresseMaps = [client.adresse, client.cp, client.ville].filter(Boolean).join(' ');
  const adresseRow = `
    <div style="margin-bottom:12px">
      <div style="font-size:0.67rem;color:#7a9e7e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Adresse</div>
      <div style="font-size:0.9rem;color:${adresseDisplay ? '#2d3b2f' : '#bbb'};font-weight:${adresseDisplay ? '500' : '400'}">
        ${adresseDisplay && adresseMaps
          ? `<a href="https://maps.google.com/?q=${encodeURIComponent(adresseMaps)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${adresseDisplay}</a>`
          : '—'}
      </div>
    </div>`;
  const animaux = client.animaux || [];
  const animauxHTML = animaux.length === 0
    ? `<div style="font-size:0.85rem;color:#bbb;margin-top:4px">Aucun animal enregistré</div>`
    : animaux.map(a => `
        <div onclick="_animalFromClient=true;voirFicheAnimal('${client.id}','${a.nom.replace(/'/g,"\\'")}');"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;background:#faf7f2;border:1px solid #e8e0d4;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-size:0.88rem;font-weight:600;color:#2d3b2f">${a.nom}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a9e7e" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`).join('');

  document.getElementById('fiche-client-content').innerHTML =
    row('Numéro', client.tel) +
    adresseRow +
    `<div style="font-size:0.67rem;color:#7a9e7e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Animaux</div>
    ${animauxHTML}`;
}

function renderFicheClientEdit(client) {
  const fs = `width:100%;border:1.5px solid #ddd6c8;border-radius:7px;padding:7px 10px;font-size:0.84rem;font-family:'DM Sans',sans-serif;background:#fff;box-sizing:border-box`;
  const wrap = (label, inner) => `<div style="margin-bottom:10px"><div style="font-size:0.75rem;color:#7a9e7e;font-weight:600;margin-bottom:3px">${label}</div>${inner}</div>`;
  const inp = (field, val, placeholder) =>
    `<input type="text" value="${(val||'').replace(/"/g,'&quot;')}" placeholder="${placeholder||''}"
       style="${fs}" oninput="saveClientField('${field}',this.value)">`;
  const grid2 = champs => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">${champs}</div>`;

  document.getElementById('fiche-client-content').innerHTML =
    wrap('Téléphone', inp('tel', client.tel, '06 00 00 00 00')) +
    wrap('Adresse', inp('adresse', client.adresse, 'Rue...')) +
    wrap('Complément d\'adresse', inp('complement', client.complement, 'Bâtiment, étage…')) +
    grid2(wrap('Code postal', inp('cp', client.cp, '69000')) + wrap('Ville', inp('ville', client.ville, 'Lyon')));
}

function saveClientField(field, val) {
  const client = _getClient();
  if (client) { client[field] = val; saveState(); }
}

let _ficheRef  = { proprioId: null, animalNom: null };
let _ficheMode = 'view';

function voirFicheAnimal(proprioId, animalNom) {
  const proprio = state.clients.find(c => c.id === proprioId);
  const animal  = proprio ? (proprio.animaux||[]).find(a => a.nom === animalNom) : null;
  if (!animal) return;
  _ficheRef  = { proprioId, animalNom };
  _ficheMode = 'view';
  document.getElementById('fiche-animal-title').textContent  = animal.nom;
  document.getElementById('fiche-animal-proprio').textContent = proprio.nom;
  renderFicheView(animal);
  const overlay = document.getElementById('modal-fiche-animal');
  overlay.style.zIndex = _animalFromClient ? '2100' : '';
  overlay.classList.add('open');
}

function _getFicheAnimal() {
  const proprio = state.clients.find(c => c.id === _ficheRef.proprioId);
  return proprio ? (proprio.animaux||[]).find(a => a.nom === _ficheRef.animalNom) : null;
}

function switchFicheMode() {
  _ficheMode = _ficheMode === 'view' ? 'edit' : 'view';
  const animal = _getFicheAnimal();
  if (!animal) return;
  const btn = document.getElementById('fiche-edit-btn');
  if (_ficheMode === 'edit') {
    btn.style.background = '#c8bfaf';
    btn.innerHTML = SVG_SAVE;
    renderFicheEdit(animal);
  } else {
    btn.style.background = 'none';
    btn.innerHTML = SVG_PENCIL;
    renderFicheView(animal);
  }
}

function renderFicheView(animal) {
  document.getElementById('notes-section').style.display = 'none';

  const section = (titre, champs) => `
    <div style="margin-bottom:16px">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:.06em;color:#7a9e7e;font-weight:700;margin-bottom:8px;padding-bottom:3px;border-bottom:1px solid #e8e0d4">${titre}</div>
      ${champs}
    </div>`;
  const row = (label, val) =>
    `<div style="margin-bottom:8px">
      <div style="font-size:0.67rem;color:#7a9e7e;font-weight:600;text-transform:uppercase;letter-spacing:.04em;line-height:1.2;margin-bottom:3px">${label}</div>
      <div style="font-size:0.88rem;color:${val ? '#2d3b2f' : '#bbb'};font-weight:${val ? '500' : '400'};line-height:1.3">${val || '—'}</div>
     </div>`;
  const grid2 = champs => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">${champs}</div>`;

  document.getElementById('fiche-animal-content').innerHTML =
    section('Identité',
      grid2(
        row('Race / Espèce', animal.race) +
        row('Sexe', animal.sexe) +
        row('Naissance', animal.naissance ? new Date(animal.naissance).toLocaleDateString('fr-FR') : '') +
        row('Âge', calcAge(animal.naissance)) +
        row('Stérilisé(e)', animal.sterilise) +
        row('Vaccins à jour', animal.vaccins)
      )
    ) +
    section('Santé',
      row('Problèmes de santé', animal.sante) +
      row('Traitement en cours', animal.traitement) +
      grid2(row('Vétérinaire', animal.veto) + row('Aliments interdits', animal.aliments))
    ) +
    section('Comportement',
      grid2(
        row('Entente chiens', animal.entente_chiens) +
        row('Entente chats', animal.entente_chats) +
        row('Entente enfants', animal.entente_enfants)
      ) +
      row('Peurs', animal.peurs) +
      row('Autres', animal.autres)
    ) +
    section('Notes personnelles', `<div style="font-size:0.88rem;color:${animal.notes ? '#2d3b2f' : '#bbb'};font-weight:${animal.notes ? '500' : '400'};line-height:1.4">${animal.notes || '—'}</div>`);
}

function renderFicheEdit(animal) {
  document.getElementById('notes-section').style.display = 'block';
  const fs = `width:100%;border:1.5px solid #ddd6c8;border-radius:7px;padding:7px 10px;font-size:0.84rem;font-family:'DM Sans',sans-serif;background:#fff;box-sizing:border-box`;
  const wrap = (label, inner) => `<div style="margin-bottom:10px"><div style="font-size:0.75rem;color:#7a9e7e;font-weight:600;margin-bottom:3px">${label}</div>${inner}</div>`;
  const s   = (label, field, val, type='text') => wrap(label, type === 'area'
    ? `<textarea rows="2" style="${fs}" oninput="saveAnimalField('${field}',this.value)">${val||''}</textarea>`
    : `<input type="${type}" value="${(val||'').toString().replace(/"/g,'&quot;')}" style="${fs}" oninput="saveAnimalField('${field}',this.value)">`);
  const sel = (label, field, val, opts) => wrap(label,
    `<select style="${fs}" onchange="saveAnimalField('${field}',this.value)">
      <option value="" ${!val?'selected':''}>—</option>
      ${opts.map(o=>`<option ${val===o?'selected':''}>${o}</option>`).join('')}
    </select>`);
  const stat = (label, val) => wrap(label, `<div style="${fs};color:#2d3b2f">${val||'—'}</div>`);
  const section = (titre, champs) => `
    <div style="margin-bottom:18px">
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.06em;color:#7a9e7e;font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e8e0d4">${titre}</div>
      ${champs}
    </div>`;

  document.getElementById('fiche-animal-content').innerHTML =
    section('Identité',
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
        ${stat('Race / Espèce', animal.race)}
        ${stat('Sexe', animal.sexe)}
        ${s('Date de naissance','naissance',animal.naissance,'date')}
        ${sel('Stérilisé(e)','sterilise',animal.sterilise,['Oui','Non'])}
        ${sel('Vaccins à jour','vaccins',animal.vaccins,['Oui','Non'])}
      </div>`) +
    section('Santé',
      s('Problèmes de santé','sante',animal.sante,'area') +
      s('Traitement en cours','traitement',animal.traitement,'area') +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
        ${s('Vétérinaire','veto',animal.veto)}
        ${s('Aliments interdits','aliments',animal.aliments)}
      </div>`) +
    section('Comportement',
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">
        ${s('Entente avec les chiens','entente_chiens',animal.entente_chiens)}
        ${s('Entente avec les chats','entente_chats',animal.entente_chats)}
        ${s('Entente avec les enfants','entente_enfants',animal.entente_enfants)}
      </div>` +
      s('Peurs','peurs',animal.peurs,'area') +
      s('Autres','autres',animal.autres,'area'));

  const notesEl = document.getElementById('fiche-animal-notes');
  notesEl.value    = animal.notes || '';
  notesEl.readOnly = false;
  notesEl.style.resize = 'vertical';
  notesEl.style.cursor = 'text';
  notesEl.style.border  = '1.5px solid #ddd6c8';
  notesEl.style.background = '#fff';
  notesEl.style.padding = '10px 12px';
}

function saveAnimalField(field, val) {
  const proprio = state.clients.find(c => c.id === _ficheRef.proprioId);
  if (!proprio) return;
  const animal = (proprio.animaux||[]).find(a => a.nom === _ficheRef.animalNom);
  if (animal) { animal[field] = val; saveState(); }
}

function saveAnimalNotes(val) { saveAnimalField('notes', val); }

function switchClientsVue(vue) {
  document.getElementById('vue-clients').style.display = vue === 'clients' ? 'block' : 'none';
  document.getElementById('vue-animaux').style.display  = vue === 'animaux'  ? 'block' : 'none';
  document.getElementById('vtab-clients').classList.toggle('active', vue === 'clients');
  document.getElementById('vtab-animaux').classList.toggle('active', vue === 'animaux');
  if (vue === 'animaux') renderAnimaux();
  if (vue === 'clients') renderClients();
}

function renderAnimaux() {
  const container = document.getElementById('carnet-animaux');
  const empty     = document.getElementById('empty-animaux');
  const svgSms = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  const tous = [];
  state.clients.forEach(c => (c.animaux||[]).forEach(a => tous.push({ c, a })));
  if (!tous.length) { container.innerHTML = ''; container.style.display = 'none'; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  container.style.display = '';

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Animal</th>
            <th>Prestation</th>
            <th>Tarif</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tous.map(({ c, a }) => `
            <tr style="cursor:pointer" onclick="voirFicheAnimal('${c.id}','${a.nom.replace(/'/g,"\\'")}')">
              <td onclick="event.stopPropagation()" style="white-space:nowrap">
                ${c.tel ? `<a href="sms:${c.tel.replace(/\s/g,'')}" class="btn-icon" title="SMS à ${c.nom}" style="color:#4a6355;display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px" onclick="event.stopPropagation()">${svgSms}</a>` : ''}
                <strong onclick="voirFicheAnimal('${c.id}','${a.nom.replace(/'/g,"\\'")}');event.stopPropagation()" style="cursor:pointer">${a.nom}</strong>${c.consent_photos === 'non' ? ' <span style="text-decoration:line-through;font-size:0.85em">📷</span>' : ''}
              </td>
              <td onclick="event.stopPropagation()">
                <select style="border:1px solid #ddd6c8;border-radius:6px;padding:4px 8px;font-size:0.82rem"
                  onchange="updateAnimalPrestation('${c.id}','${a.nom.replace(/'/g,"\\'")}',this.value)">
                  <option value="" ${!a.prestation?'selected':''}>À définir</option>
                  ${state.prestationsTypes.map(t=>`<option ${t===a.prestation?'selected':''}>${t}</option>`).join('')}
                </select>
              </td>
              <td onclick="event.stopPropagation()" style="white-space:nowrap">
                <input type="number" value="${a.tarif||''}" step="0.5" min="0" placeholder="—"
                  style="width:36px;font-size:0.82rem;padding:4px 5px;border:1px solid #ddd6c8;border-radius:6px;text-align:center"
                  onchange="updateAnimalTarif('${c.id}','${a.nom.replace(/'/g,"\\'")}',parseFloat(this.value)||0)"><span style="font-size:0.78rem;color:#4a6355;margin-left:3px">€</span>
              </td>
              <td onclick="event.stopPropagation()">
                <button class="btn-icon btn-danger-icon" onclick="supprimerAnimal('${c.id}','${a.nom.replace(/'/g,"\\'")}');renderAnimaux()" title="Supprimer"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderClients() {
  const container = document.getElementById('carnet-clients');
  const empty = document.getElementById('empty-clients');
  if (!state.clients.length) { container.innerHTML = ''; container.style.display = 'none'; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  container.style.display = '';
  const svgTrash = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
  const svgSms = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Règlement</th>
            <th title="Client venu via flyer">Flyer</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.clients.map(c => `
            <tr style="cursor:pointer" onclick="voirFicheClient('${c.id}')">
              <td onclick="event.stopPropagation()" style="white-space:nowrap">
                ${c.tel ? `<a href="sms:${c.tel.replace(/\s/g,'')}" class="btn-icon" title="Envoyer un SMS" style="color:#4a6355;display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px" onclick="event.stopPropagation()">${svgSms}</a>` : ''}
                <strong onclick="voirFicheClient('${c.id}')" style="cursor:pointer">${c.nom}</strong>
              </td>
              <td onclick="event.stopPropagation()">
                <select onchange="updateModeClient('${c.id}',this.value)" style="border:1px solid #ddd6c8;border-radius:6px;padding:4px 8px;font-size:0.82rem">
                  <option value="" ${!c.mode?'selected':''}>À définir</option>
                  ${['Liquide','Virement','Chèque'].map(m=>`<option ${c.mode===m?'selected':''}>${m}</option>`).join('')}
                </select>
              </td>
              <td onclick="event.stopPropagation()" style="text-align:center">
                <input type="checkbox" ${c.flyer?'checked':''} onchange="toggleFlyerClient('${c.id}',this.checked)" title="Client venu via flyer" style="width:16px;height:16px;cursor:pointer;accent-color:#154734">
              </td>
              <td onclick="event.stopPropagation()">
                <button class="btn-icon btn-danger-icon" onclick="supprimerClient('${c.id}')" title="Supprimer">${svgTrash}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function updateModeClient(clientId, mode) {
  const c = state.clients.find(x => x.id === clientId);
  if (c) { c.mode = mode; saveState(); }
}

function toggleFlyerClient(clientId, checked) {
  const c = state.clients.find(x => x.id === clientId);
  if (c) { c.flyer = checked; saveState(); }
}

function updateClientField(clientId, field, value) {
  const c = state.clients.find(x => x.id === clientId);
  if (c) { c[field] = value; saveState(); }
}

// ═══════════════════════════════════════════════════════════════
// TOGGLE SECTION (collapsibles)
// ═══════════════════════════════════════════════════════════════

function toggleSection(id) {
  const el = document.getElementById(id);
  const toggle = el ? el.previousElementSibling : null;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  if (toggle && toggle.classList.contains('card-toggle')) toggle.classList.toggle('open', !isOpen);
}


function updateAnimalPrestation(clientId, animalNom, prestation) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const a = (c.animaux||[]).find(x => x.nom === animalNom);
  if (a) { a.prestation = prestation; saveState(); populateSelects(); }
}

function updateAnimalTarif(clientId, animalNom, tarif) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;
  const a = (c.animaux||[]).find(x => x.nom === animalNom);
  if (a) { a.tarif = tarif; saveState(); populateSelects(); }
}

// ═══════════════════════════════════════════════════════════════
// FACTURES — nouvelles fonctions
// ═══════════════════════════════════════════════════════════════

function exporterFacturePDF(id) { genererPDFFromRecette(id); }

function supprimerRecette(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  const r = state.recettes.find(x => x.id === id);
  if (r) {
    state.prestations.forEach(p => { if (p.facture === r.ref) p.facture = null; });
  }
  state.recettes = state.recettes.filter(x => x.id !== id);
  saveState(); renderRecettes(); renderPrestations();
}

// ═══════════════════════════════════════════════════════════════
// DÉPENSES
// ═══════════════════════════════════════════════════════════════

let depenseMode = 'depense';

function setDepenseMode(mode) {
  depenseMode = mode;
  const lDep = document.getElementById('btn-mode-depense-label');
  const lCA  = document.getElementById('btn-mode-caextra-label');
  lDep.style.background = mode === 'depense' ? 'var(--accent)' : 'transparent';
  lDep.style.color      = mode === 'depense' ? '#fff' : 'var(--text2)';
  lCA.style.background  = mode === 'caextra' ? 'var(--accent)' : 'transparent';
  lCA.style.color       = mode === 'caextra' ? '#fff' : 'var(--text2)';
  document.getElementById('dep-type-group').style.display = mode === 'depense' ? '' : 'none';
}

function ajouterDepense() {
  const label = document.getElementById('dep-label').value.trim();
  const date = document.getElementById('dep-date').value;
  const montant = parseFloat(document.getElementById('dep-montant').value) || 0;
  if (!date) { showAlert('alert-depenses', '⚠️ La date est obligatoire.', 'error'); return; }

  if (depenseMode === 'caextra') {
    state.caExtra.push({ id: uid(), label, date, montant });
    saveState();
    ['dep-label','dep-montant'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('dep-date').value = dateToISO(new Date());
    renderDepenses();
    showAlert('alert-depenses', 'Extra ajouté.', 'success');
  } else {
    const type = document.getElementById('dep-type').value;
    state.depenses.push({ id: uid(), type, label, date, montant });
    saveState();
    ['dep-type','dep-label','dep-montant'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('dep-date').value = dateToISO(new Date());
    renderDepenses();
    showAlert('alert-depenses', 'Charge ajoutée.', 'success');
  }
}

function renderDepenses() {
  const tbody  = document.getElementById('tbody-depenses');
  const empty  = document.getElementById('empty-depenses');
  const total  = document.getElementById('total-depenses-annee');
  const anneeEl = document.getElementById('filter-annee-d');
  const moisEl  = document.getElementById('filter-mois-d');
  const typeEl  = document.getElementById('filter-type-d');

  const depenses = (state.depenses || []).map(d => ({...d, _caextra: false}));
  const extras   = (state.caExtra  || []).map(e => ({...e, type: '__caextra__', _caextra: true}));
  const all = [...depenses, ...extras].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const nowD = new Date();
  const defAnneeD = String(nowD.getFullYear());
  const defMoisD  = MOIS_LIST[nowD.getMonth()];

  // Auto-alimenter le select année
  const baseYears = [...new Set(all.map(d => d.date ? d.date.slice(0,4) : null).filter(Boolean))].sort().reverse();
  const years = baseYears.includes(defAnneeD) ? baseYears : [defAnneeD, ...baseYears];
  const curAnnee = anneeEl.value || defAnneeD;
  anneeEl.innerHTML = '<option value="">Année</option>' +
    years.map(y => `<option${y===curAnnee?' selected':''}>${y}</option>`).join('');

  // Auto-alimenter le select mois
  const moisPresents = [...new Set(all.map(d => d.date ? getMoisFromDate(d.date) : null).filter(Boolean))];
  const baseMois = MOIS_LIST.filter(m => moisPresents.includes(m));
  const moisOrdonnes = baseMois.includes(defMoisD) ? baseMois : [...baseMois, defMoisD].sort((a,b) => MOIS_LIST.indexOf(a)-MOIS_LIST.indexOf(b));
  const curMois = moisEl.value || defMoisD;
  moisEl.innerHTML = '<option value="">Mois</option>' +
    moisOrdonnes.map(m => `<option${m===curMois?' selected':''}>${m}</option>`).join('');

  const anneeF = anneeEl.value;
  const moisF  = moisEl.value;
  const typeF  = typeEl ? typeEl.value : '';

  let items = all;
  if (anneeF) items = items.filter(d => d.date && d.date.startsWith(anneeF));
  if (moisF)  items = items.filter(d => d.date && getMoisFromDate(d.date) === moisF);
  if (typeF)  items = items.filter(d => d.type === typeF);

  const sumDep   = items.filter(d => !d._caextra).reduce((s,d) => s + (d.montant||0), 0);
  const sumExtra = items.filter(d =>  d._caextra).reduce((s,d) => s + (d.montant||0), 0);
  total.innerHTML = `${sumDep.toFixed(2).replace('.',',')} € charges${sumExtra > 0 ? ` &nbsp;|&nbsp; +${sumExtra.toFixed(2).replace('.',',')} € extra` : ''}`;

  if (!items.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const svgTrash = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
  tbody.innerHTML = items.map(d => {
    const isExtra = d._caextra;
    const typeLabel = isExtra ? '<span style="color:#2d7a4f;font-weight:600;font-size:0.82rem">Extra</span>' : `<span style="color:var(--text2);font-size:0.82rem">${d.type||'—'}</span>`;
    const montantLabel = isExtra
      ? `<span style="color:#2d7a4f;font-weight:600">+${(d.montant||0).toFixed(2)} €</span>`
      : `${(d.montant||0).toFixed(2)} €`;
    const deleteBtn = isExtra
      ? `<button class="btn-icon btn-danger-icon" onclick="supprimerCaExtra('${d.id}')" title="Supprimer">${svgTrash}</button>`
      : `<button class="btn-icon btn-danger-icon" onclick="supprimerDepense('${d.id}')" title="Supprimer">${svgTrash}</button>`;
    return `<tr>
      <td>${d.date ? new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR') : ''}</td>
      <td>${typeLabel}</td>
      <td>${d.label||'—'}</td>
      <td>${montantLabel}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join('');
}

function supprimerDepense(id) {
  if (!confirm('Supprimer cette charge ?')) return;
  state.depenses = state.depenses.filter(d => d.id !== id);
  saveState(); renderDepenses();
}

function supprimerCaExtra(id) {
  if (!confirm('Supprimer cet extra ?')) return;
  state.caExtra = state.caExtra.filter(e => e.id !== id);
  saveState(); renderDepenses();
}

// ═══════════════════════════════════════════════════════════════
// DONNÉES
// ═══════════════════════════════════════════════════════════════

function renderDonnees() {
  const liste = document.getElementById('liste-prestations-types');
  liste.innerHTML = state.prestationsTypes.map((t,i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:var(--radius-sm);background:var(--surface2);margin-bottom:6px">
      <span style="font-size:0.88rem">${t}</span>
      <button class="btn-icon btn-danger-icon" onclick="supprimerTypePrestation(${i})" title="Supprimer"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
    </div>
  `).join('');
}

function ajouterTypePrestation() {
  const val = document.getElementById('new-prestation').value.trim();
  if (!val) return;
  if (state.prestationsTypes.includes(val)) { alert('Cette prestation existe déjà.'); return; }
  state.prestationsTypes.push(val);
  saveState();
  populateSelects();
  renderDonnees();
  document.getElementById('new-prestation').value = '';
}

function supprimerTypePrestation(i) {
  state.prestationsTypes.splice(i, 1);
  saveState();
  populateSelects();
  renderDonnees();
}

function renderConfig() {
  const cfg = state.config || DEFAULT_CONFIG;
  document.getElementById('cfg-nom').value         = cfg.nom || '';
  document.getElementById('cfg-statut').value      = cfg.statut || '';
  document.getElementById('cfg-siret').value       = cfg.siret || '';
  document.getElementById('cfg-ape').value         = cfg.ape || '';
  document.getElementById('cfg-adresse1').value    = cfg.adresse1 || '';
  document.getElementById('cfg-adresse2').value    = cfg.adresse2 || '';
}

function saveConfig() {
  state.config = {
    nom:      document.getElementById('cfg-nom').value.trim(),
    statut:   document.getElementById('cfg-statut').value.trim(),
    siret:    document.getElementById('cfg-siret').value.trim(),
    ape:      document.getElementById('cfg-ape').value.trim(),
    adresse1: document.getElementById('cfg-adresse1').value.trim(),
    adresse2: document.getElementById('cfg-adresse2').value.trim(),
  };
  saveState();
  showAlert('alert-donnees', 'Profil enregistré.', 'success');
}

function exporterDonnees() {
  const json = JSON.stringify({ ...state, notes: loadNotes() }, null, 2);
  const blob = new Blob([json], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `petsitter_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

function exporterRecettesCSV() {
  if (!state.recettes.length) {
    showAlert('alert-donnees', 'Aucune recette à exporter.', 'error');
    return;
  }
  const cols = ['Référence', 'Client', 'Type de prestation', 'Date de facturation', 'Montant (€)', 'Mode de paiement', 'Statut', 'Date de paiement'];
  const rows = state.recettes
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map(r => {
      const date = r.date ? new Date(r.date).toLocaleDateString('fr-FR') : '';
      const datePaiement = r.datePaiement ? new Date(r.datePaiement).toLocaleDateString('fr-FR') : '';
      const montant = String(r.montant).replace('.', ',');
      const type = getTypePrestation(getPrestsForRecette(r));
      return [r.ref, r.client, type, date, montant, r.mode || '', r.statut || '', datePaiement]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(';');
    });
  const csv = [cols.join(';'), ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recettes_dardidog_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
}

function importerDonnees(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);

      // Fiche client depuis le formulaire d'inscription
      if (data._type === 'petsitter_fiche_client') {
        importerFicheClient(data);
        return;
      }

      // Sauvegarde complète
      if (!data.prestations || !data.clients) throw new Error('Format invalide');
      state.prestations = data.prestations;
      state.recettes = data.recettes || [];
      state.depenses = data.depenses || [];
      state.caExtra = data.caExtra || [];
      state.clients = data.clients || [];
      state.evenements = data.evenements || [];
      state.prestationsTypes = data.prestationsTypes || [...DEFAULT_PRESTATIONS_TYPES];
      state.lastFactureNum = data.lastFactureNum || 1;
      if (data.config) state.config = data.config;
      if (data.notes) saveNotes(data.notes);
      saveState();
      populateSelects();
      renderPrestations();
      showAlert('alert-donnees', '✅ Sauvegarde importée avec succès !', 'success');
    } catch(err) {
      showAlert('alert-donnees', '❌ Erreur lors de l\'import : ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function importerFicheClient(data) {
  const proprio = data.proprietaire;
  const animaux = data.animaux || [];

  if (!proprio || !proprio.nom) {
    showAlert('alert-clients', '❌ Fiche invalide : nom du propriétaire manquant.', 'error');
    return;
  }

  const existant = state.clients.find(c => c.nom.toLowerCase() === proprio.nom.toLowerCase());
  if (existant) {
    if (!confirm(`"${proprio.nom}" existe déjà. Mettre à jour et ajouter les nouveaux animaux ?`)) return;
    existant.tel = proprio.tel || existant.tel;
    existant.adresse = proprio.adresse || existant.adresse;
    existant.complement = proprio.complement || existant.complement;
    existant.cp = proprio.cp || existant.cp;
    existant.ville = proprio.ville || existant.ville;
    if (proprio.consent_photos) existant.consent_photos = proprio.consent_photos;
    animaux.forEach(a => {
      if (!existant.animaux.find(ea => ea.nom.toLowerCase() === a.nom.toLowerCase())) {
        existant.animaux.push({ ...a, prestation:'', tarif:0 });
      }
    });
    saveState(); populateSelects(); renderClients(); showPage('clients');
    showAlert('alert-clients', `✅ Fiche de ${proprio.nom} mise à jour — ${animaux.length} animal(aux).`, 'success');
    return;
  }

  state.clients.push({
    id: uid(), nom: proprio.nom, tel: proprio.tel||'', adresse: proprio.adresse||'',
    complement: proprio.complement||'', cp: proprio.cp||'', ville: proprio.ville||'',
    consent_photos: proprio.consent_photos||'',
    mode: '',
    animaux: animaux.map(a => ({
      nom:a.nom||'', race:a.race||'', sexe:a.sexe||'', naissance:a.naissance||'',
      sterilise:a.sterilise||'', vaccins:a.vaccins||'', sante:a.sante||'',
      traitement:a.traitement||'', veto:a.veto||'', aliments:a.aliments||'',
      entente_chiens:a.entente_chiens||'', entente_chats:a.entente_chats||'',
      entente_enfants:a.entente_enfants||'', peurs:a.peurs||'', autres:a.autres||'',
      prestation:'', tarif:0,
    }))
  });
  saveState(); populateSelects(); renderClients(); showPage('clients');
  showAlert('alert-clients',
    `✅ ${proprio.nom} importé(e) avec ${animaux.length} animal(aux) : ${animaux.map(a=>a.nom).join(', ')}`,
    'success');
}

function importerDepuisMail() {
  const raw = document.getElementById('paste-json').value.trim();
  if (!raw) {
    showAlert('alert-clients', '⚠️ Collez d\'abord le JSON du mail dans la zone de texte.', 'error');
    return;
  }
  try {
    const data = JSON.parse(raw);
    if (data._type !== 'petsitter_fiche_client') {
      showAlert('alert-clients', '❌ Ce JSON n\'est pas une fiche client Dardidog.', 'error');
      return;
    }
    importerFicheClient(data);
    document.getElementById('paste-json').value = '';
  } catch(err) {
    showAlert('alert-clients', '❌ JSON invalide — vérifiez que vous avez copié l\'intégralité du corps du mail. (' + err.message + ')', 'error');
  }
}

function hardReset() {
  if (!confirm('⚠️ Reset forcé : efface TOUT le localStorage et recharge la page ?')) return;
  // Effacer toutes les clés liées à l'appli
  Object.keys(localStorage).forEach(k => {
    if (k.includes('petsitter')) localStorage.removeItem(k);
  });
  localStorage.removeItem('petsitter_data');
  // Forcer le rechargement complet
  window.location.reload(true);
}

function resetDonnees() {
  if (!confirm('⚠️ Effacer TOUTES les données ? Cette action est irréversible.')) return;
  localStorage.removeItem('petsitter_data');
  const def = getDefaultState();
  state.prestations = def.prestations;
  state.recettes = def.recettes;
  state.depenses = def.depenses;
  state.evenements = def.evenements;
  state.clients = def.clients;
  state.prestationsTypes = def.prestationsTypes;
  state.lastFactureNum = def.lastFactureNum;
  saveState();
  populateSelects();
  renderPrestations();
  renderClients();
  alert('Données réinitialisées.');
}

// ═══════════════════════════════════════════════════════════════
// ÉVÉNEMENTS PERSONNELS
// ═══════════════════════════════════════════════════════════════

function eventsForDate(iso) {
  return (state.evenements || []).filter(ev => {
    if (ev.type === 'heure' || ev.type === 'journee') return ev.date === iso;
    if (ev.type === 'periode') return ev.dateDebut <= iso && ev.dateFin >= iso;
    return false;
  });
}

function updateEvForm() {
  const type = document.querySelector('input[name="ev-type"]:checked').value;
  document.getElementById('ev-grp-date').style.display    = (type === 'heure' || type === 'journee') ? '' : 'none';
  document.getElementById('ev-grp-hdebut').style.display  = type === 'heure' ? '' : 'none';
  document.getElementById('ev-grp-hfin').style.display    = type === 'heure' ? '' : 'none';
  document.getElementById('ev-grp-periode').style.display = type === 'periode' ? '' : 'none';
}

function autoFillHeureFinEv() {
  const hdebut = document.getElementById('ev-hdebut');
  const hfin   = document.getElementById('ev-hfin');
  if (!hdebut.value) return;
  const [h, m] = hdebut.value.split(':').map(Number);
  const total = h * 60 + m + 60;
  hfin.value = `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}

function ajouterEvenement() {
  const nom  = document.getElementById('ev-nom').value.trim();
  const type = document.querySelector('input[name="ev-type"]:checked').value;
  if (!nom) { showAlert('alert-evenement', 'Entrez un nom pour l\'événement.', 'error'); return; }
  const ev = { id: uid(), nom, type };
  if (type === 'heure' || type === 'journee') {
    const date = document.getElementById('ev-date').value;
    if (!date) { showAlert('alert-evenement', 'Sélectionnez une date.', 'error'); return; }
    ev.date = date;
    if (type === 'heure') {
      ev.heureDebut = document.getElementById('ev-hdebut').value;
      ev.heureFin   = document.getElementById('ev-hfin').value;
    }
  } else {
    const dateDebut = document.getElementById('ev-datedebut').value;
    const dateFin   = document.getElementById('ev-datefin').value;
    if (!dateDebut || !dateFin) { showAlert('alert-evenement', 'Sélectionnez une période.', 'error'); return; }
    ev.dateDebut = dateDebut;
    ev.dateFin   = dateFin;
  }
  if (!state.evenements) state.evenements = [];
  state.evenements.push(ev);
  saveState();
  syncEventsPush();
  document.getElementById('ev-nom').value = '';
  document.getElementById('ev-date').value = '';
  document.getElementById('ev-hdebut').value = '';
  document.getElementById('ev-hfin').value = '';
  document.getElementById('ev-datedebut').value = '';
  document.getElementById('ev-datefin').value = '';
  document.getElementById('ev-drp-btn').textContent = 'Sélectionner les dates';
  document.querySelector('input[name="ev-type"][value="heure"]').checked = true;
  updateEvForm();
  renderPlanning();
  showAlert('alert-evenement', 'Événement ajouté.', 'success');
}

function supprimerEvenement(id) {
  if (!confirm('Supprimer cet événement ?')) return;
  state.evenements = (state.evenements || []).filter(e => e.id !== id);
  saveState();
  syncEventsPush();
  renderPlanning();
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

let _toastTimer = null;
function showAlert(containerId, msg, type) {
  const toast = document.getElementById('gs-toast');
  if (!toast) return;
  if (_toastTimer) clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className = `show toast-${type === 'error' ? 'error' : 'success'}`;
  _toastTimer = setTimeout(() => { toast.className = ''; }, 4000);
}

function seDeconnecter() {
  localStorage.removeItem('dardidog_auth');
  window.location.replace('suivi-2m0x.html');
}

// ═══════════════════════════════════════════════════════════════
// NOTES
// ═══════════════════════════════════════════════════════════════

function loadNotes() {
  try { return JSON.parse(localStorage.getItem('petsitter_notes') || '[]'); } catch(e) { return []; }
}

function saveNotes(notes) {
  localStorage.setItem('petsitter_notes', JSON.stringify(notes));
}

function renderNotes() {
  const notes = loadNotes();
  const list = document.getElementById('notes-list');
  if (!list) return;
  list.innerHTML = notes.map((txt, idx) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--border)">
      <input type="checkbox" onchange="removeNoteItem(${idx})"
        style="width:18px;height:18px;cursor:pointer;accent-color:var(--color-primary);flex-shrink:0">
      <span style="font-size:0.95rem;line-height:1.4">${txt.replace(/</g,'&lt;')}</span>
    </div>`).join('');
}

function addNoteItem() {
  const input = document.getElementById('notes-input');
  const txt = (input.value || '').trim();
  if (!txt) return;
  const notes = loadNotes();
  notes.push(txt);
  saveNotes(notes);
  input.value = '';
  renderNotes();
  input.focus();
}

function removeNoteItem(idx) {
  const notes = loadNotes();
  notes.splice(idx, 1);
  saveNotes(notes);
  setTimeout(renderNotes, 200);
}

function closeModal(id) {
  const el = document.getElementById(id || 'modal-overlay');
  if (el) el.classList.remove('open');
  if (id === 'modal-fiche-animal' && _animalFromClient) {
    _animalFromClient = false;
    el.style.zIndex = '';
    document.getElementById('modal-fiche-client').classList.add('open');
  }
}

// ═══════════════════════════════════════════════════════════════
// DATE RANGE PICKER
// ═══════════════════════════════════════════════════════════════

let _drpStartId, _drpEndId, _drpBtnId, _drpStart = null, _drpEnd = null;
let _drpCurrentMonth;

function ouvrirDateRange(startId, endId, btnId) {
  _drpStartId = startId;
  _drpEndId = endId;
  _drpBtnId = btnId;
  _drpStart = document.getElementById(startId).value || null;
  _drpEnd = document.getElementById(endId).value || null;
  const now = new Date();
  _drpCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  renderDRP();
  document.getElementById('drp-overlay').classList.add('open');
}

function fermerDateRange() {
  document.getElementById('drp-overlay').classList.remove('open');
}

function drpOverlayClick(e) {
  if (e.target === document.getElementById('drp-overlay')) fermerDateRange();
}

function drpPrevMonth() {
  _drpCurrentMonth = new Date(_drpCurrentMonth.getFullYear(), _drpCurrentMonth.getMonth() - 1, 1);
  renderDRP();
}

function drpNextMonth() {
  _drpCurrentMonth = new Date(_drpCurrentMonth.getFullYear(), _drpCurrentMonth.getMonth() + 1, 1);
  renderDRP();
}

function renderDRP() {
  const year = _drpCurrentMonth.getFullYear();
  const month = _drpCurrentMonth.getMonth();
  document.getElementById('drp-label-mois').textContent =
    _drpCurrentMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const startDow = (new Date(year, month, 1).getDay() + 6) % 7; // Lu=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid = document.getElementById('drp-grid');
  grid.innerHTML = '';

  for (let i = 0; i < startDow; i++) {
    const el = document.createElement('div');
    el.className = 'drp-day drp-empty';
    el.innerHTML = '<span class="drp-num"></span>';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const el = document.createElement('div');
    el.className = 'drp-day';
    el.innerHTML = `<span class="drp-num">${d}</span>`;
    el.onclick = () => drpSelectDay(iso);
    if (_drpStart === iso) el.classList.add('drp-start');
    if (_drpEnd === iso) el.classList.add('drp-end');
    if (_drpStart && _drpEnd && iso > _drpStart && iso < _drpEnd) el.classList.add('drp-in-range');
    grid.appendChild(el);
  }

  const hint = document.getElementById('drp-hint');
  if (!_drpStart) {
    hint.textContent = 'Sélectionnez la date de début';
  } else if (!_drpEnd) {
    const dFmt = new Date(_drpStart + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    hint.textContent = `Début : ${dFmt} — Sélectionnez la date de fin`;
  } else {
    const deb = new Date(_drpStart + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const fin = new Date(_drpEnd + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    hint.textContent = `Du ${deb} au ${fin}`;
  }

  document.getElementById('drp-confirm').disabled = !(_drpStart && _drpEnd);
}

function drpSelectDay(iso) {
  if (!_drpStart || (_drpStart && _drpEnd)) {
    _drpStart = iso;
    _drpEnd = null;
  } else {
    if (iso < _drpStart) {
      _drpEnd = _drpStart;
      _drpStart = iso;
    } else {
      _drpEnd = iso;
    }
  }
  renderDRP();
}

function drpConfirm() {
  if (!_drpStart || !_drpEnd) return;
  document.getElementById(_drpStartId).value = _drpStart;
  document.getElementById(_drpEndId).value = _drpEnd;
  const deb = new Date(_drpStart + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const fin = new Date(_drpEnd + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const btn = document.getElementById(_drpBtnId);
  if (btn) btn.textContent = `${deb} — ${fin}`;
  document.getElementById('drp-overlay').classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

function init() {
  runMigrations();
  document.getElementById('p-date').value = new Date().toISOString().split('T')[0];
  populateSelects();
  renderPrestations();
  renderClients();
  registerPushNotifications();
  syncEventsPush();
}

init();