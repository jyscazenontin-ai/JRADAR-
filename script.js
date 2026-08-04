(function(){
  // ---------- Configuration Firebase ----------
  const firebaseConfig = {
    apiKey: "AIzaSyDIXIjsUDdV6UNskuLsSkheTN7PsCPMSLs",
    authDomain: "jradar-f5f70.firebaseapp.com",
    projectId: "jradar-f5f70",
    storageBucket: "jradar-f5f70.firebasestorage.app",
    messagingSenderId: "163034212493",
    appId: "1:163034212493:web:ebb74126a13ce0a2dd1ac4",
    measurementId: "G-BCDWKVDQKT"
  };
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const VISITS_BASELINE = 490;

  let businesses = [];
  let userPos = null; // {lat, lng}
  let activeCategory = 'Tous';
  let searchTerm = '';
  let pendingLat = null, pendingLng = null;
  let pendingLogo = null; // base64 string ou null

  const CATEGORIES = ['Tous','Restauration','Beauté & bien-être','Santé','Commerce','Services pro','Éducation','Autre'];
  const CATEGORY_EMOJI = {
    'Restauration':'🍽️', 'Beauté & bien-être':'💇', 'Santé':'🏥',
    'Commerce':'🛍️', 'Services pro':'🔧', 'Éducation':'📚', 'Autre':'📦'
  };

  // ---------- Onglets ----------
  function activateTab(tab){
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if(btn) btn.classList.add('active');
    document.querySelectorAll('section').forEach(s=>s.classList.remove('active'));
    const sec = document.getElementById(tab);
    if(sec) sec.classList.add('active');
  }
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> activateTab(btn.dataset.tab));
  });

  // ---------- Points animés sur le radar du hero ----------
  const radarViz = document.getElementById('radarViz');
  if(radarViz){
    const radarSize = radarViz.offsetWidth || 160;
    for(let i=0;i<5;i++){
      const p = document.createElement('div');
      p.className = 'ping';
      const angle = Math.random()*Math.PI*2;
      const r = (radarSize*0.15) + Math.random()*(radarSize*0.3);
      p.style.left = (radarSize/2 + r*Math.cos(angle)) + 'px';
      p.style.top = (radarSize/2 + r*Math.sin(angle)) + 'px';
      p.style.animationDelay = (Math.random()*2)+'s';
      radarViz.appendChild(p);
    }
  }

  // ---------- Calcul de distance (formule de Haversine) ----------
  function distanceKm(lat1, lon1, lat2, lon2){
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  function formatDist(km){
    if(km < 1) return Math.round(km*1000) + ' m';
    return km.toFixed(1).replace('.', ',') + ' km';
  }

  function genMgmtCode(){
    return Math.random().toString(36).slice(2,10).toUpperCase();
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- Firestore : chargement des entreprises ----------
  async function loadBusinesses(){
    try{
      const snap = await db.collection('businesses').orderBy('createdAt','desc').get();
      businesses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }catch(e){
      console.error('Erreur de chargement Firestore', e);
      businesses = [];
    }
    renderChips();
    renderList();
    updateStats();
  }

  async function addBusinessToDb(entry){
    const ref = await db.collection('businesses').add(entry);
    return ref.id;
  }
  async function updateBusinessInDb(id, data){
    await db.collection('businesses').doc(id).update(data);
  }
  async function deleteBusinessFromDb(id){
    await db.collection('businesses').doc(id).delete();
  }
  async function addReviewToDb(id, review){
    await db.collection('businesses').doc(id).update({
      reviews: firebase.firestore.FieldValue.arrayUnion(review)
    });
  }

  function updateStats(){
    const el = document.getElementById('statBiz');
    if(el) el.textContent = businesses.length.toLocaleString('fr-FR');
  }

  // ---------- Compteur de visiteurs (compteur atomique Firestore) ----------
  async function trackVisit(){
    try{
      const ref = db.collection('meta').doc('visits');
      const doc = await ref.get();
      let count;
      if(!doc.exists){
        count = VISITS_BASELINE + 1;
        await ref.set({ count });
      } else {
        await ref.update({ count: firebase.firestore.FieldValue.increment(1) });
        const updated = await ref.get();
        count = updated.data().count;
      }
      const el = document.getElementById('statVisits');
      if(el) el.textContent = count.toLocaleString('fr-FR');
    }catch(e){
      console.error('Erreur compteur visiteurs', e);
    }
  }

  // ---------- Géolocalisation (page Découvrir) ----------
  const locBanner = document.getElementById('locBanner');
  const locStatus = document.getElementById('locStatus');
  const locBtn = document.getElementById('locBtn');

  function requestUserLocation(){
    if(!locBtn) return;
    if(!navigator.geolocation){
      locStatus.textContent = "📍 La géolocalisation n'est pas disponible sur cet appareil.";
      return;
    }
    locStatus.textContent = '📍 Localisation en cours…';
    navigator.geolocation.getCurrentPosition(
      pos=>{
        userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locBanner.classList.add('ok');
        locStatus.innerHTML = '<strong>Position activée</strong> — résultats triés par proximité.';
        locBtn.textContent = 'Actualiser';
        renderList();
      },
      err=>{
        locStatus.textContent = "📍 Position refusée — active-la dans ton navigateur pour trier par distance.";
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
  if(locBtn) locBtn.addEventListener('click', requestUserLocation);

  // ---------- Filtres ----------
  const chipsEl = document.getElementById('chips');
  function renderChips(){
    if(!chipsEl) return;
    chipsEl.innerHTML = '';
    CATEGORIES.forEach(cat=>{
      const c = document.createElement('button');
      c.className = 'chip' + (cat === activeCategory ? ' active' : '');
      c.textContent = cat;
      c.addEventListener('click', ()=>{
        activeCategory = cat;
        renderChips();
        renderList();
      });
      chipsEl.appendChild(c);
    });
  }

  const searchInputEl = document.getElementById('searchInput');
  if(searchInputEl){
    searchInputEl.addEventListener('input', e=>{
      searchTerm = e.target.value.trim().toLowerCase();
      if(searchTerm) activateTab('discover');
      renderList();
    });
  }

  // ---------- Avis ----------
  function avgRating(b){
    if(!b.reviews || b.reviews.length === 0) return null;
    const sum = b.reviews.reduce((s,r)=> s + r.rating, 0);
    return sum / b.reviews.length;
  }

  function toggleReviewPanel(bizId){
    const panel = document.getElementById('rev_' + bizId);
    if(panel) panel.classList.toggle('show');
  }

  async function submitReview(bizId){
    const nameEl = document.getElementById('rn_' + bizId);
    const ratingEl = document.getElementById('rr_' + bizId);
    const commentEl = document.getElementById('rc_' + bizId);
    const name = nameEl.value.trim() || 'Anonyme';
    const rating = parseInt(ratingEl.value, 10);
    const comment = commentEl.value.trim();
    if(!comment){ commentEl.focus(); return; }

    const biz = businesses.find(b=>b.id === bizId);
    if(!biz) return;
    const review = { name, rating, comment, date: Date.now() };

    try{
      await addReviewToDb(bizId, review);
      if(!biz.reviews) biz.reviews = [];
      biz.reviews.push(review);
      renderList();
      setTimeout(()=>{
        const panel = document.getElementById('rev_' + bizId);
        if(panel) panel.classList.add('show');
      }, 0);
    }catch(e){
      console.error('Erreur envoi avis', e);
    }
  }

  // ---------- Affichage de la liste (page Découvrir) ----------
  const bizGrid = document.getElementById('bizGrid');
  function renderList(){
    if(!bizGrid) return;
    let list = businesses.slice();

    if(activeCategory !== 'Tous'){
      list = list.filter(b => b.category === activeCategory);
    }
    if(searchTerm){
      list = list.filter(b =>
        b.name.toLowerCase().includes(searchTerm) ||
        b.desc.toLowerCase().includes(searchTerm) ||
        b.addr.toLowerCase().includes(searchTerm) ||
        b.category.toLowerCase().includes(searchTerm)
      );
    }

    list = list.map(b=>{
      let dist = null;
      if(userPos && typeof b.lat === 'number' && typeof b.lng === 'number'){
        dist = distanceKm(userPos.lat, userPos.lng, b.lat, b.lng);
      }
      return { ...b, _dist: dist };
    });

    if(userPos){
      list.sort((a,b)=>{
        if(a._dist === null) return 1;
        if(b._dist === null) return -1;
        return a._dist - b._dist;
      });
    } else {
      list.sort((a,b)=> b.createdAt - a.createdAt);
    }

    bizGrid.innerHTML = '';
    if(list.length === 0){
      bizGrid.innerHTML = '<div class="empty-state">Aucune entreprise inscrite pour le moment. Sois le premier via l\'onglet "Inscription" !</div>';
      return;
    }

    list.forEach(b=>{
      const card = document.createElement('div');
      card.className = 'biz-card';
      const phoneDigits = (b.phone || '').replace(/[^\d]/g, '');
      const mapsUrl = (typeof b.lat === 'number' && typeof b.lng === 'number')
        ? `https://www.google.com/maps?q=${b.lat},${b.lng}`
        : `https://www.google.com/maps/search/${encodeURIComponent(b.addr)}`;
      const waMsg = encodeURIComponent(`Bonjour ${b.name}, je vous ai trouvé sur JRADAR. Je souhaiterais passer commande / avoir plus d'informations.`);
      const avg = avgRating(b);
      const reviews = b.reviews || [];
      const logoHtml = b.logo
        ? `<img class="biz-logo" src="${b.logo}" alt="Logo ${escapeHtml(b.name)}">`
        : `<div class="biz-logo">${CATEGORY_EMOJI[b.category] || '📦'}</div>`;

      card.innerHTML = `
        <div class="biz-top">
          <div class="biz-identity">
            ${logoHtml}
            <div>
              <div class="biz-cat">${b.category}</div>
              <div class="biz-name">${escapeHtml(b.name)}</div>
              ${avg !== null ? `<div class="biz-rating">★ ${avg.toFixed(1)} (${reviews.length})</div>` : ''}
            </div>
          </div>
          ${b._dist !== null ? `<div class="biz-dist">${formatDist(b._dist)}</div>` : ''}
        </div>
        <div class="biz-desc">${escapeHtml(b.desc)}</div>
        <div class="biz-addr">📍 ${escapeHtml(b.addr)}</div>
        <div class="biz-actions">
          <a class="biz-btn" href="${mapsUrl}" target="_blank" rel="noopener">🗺️ Carte</a>
          ${phoneDigits ? `<a class="biz-btn primary" href="https://wa.me/${phoneDigits}?text=${waMsg}" target="_blank" rel="noopener">💬 Commander</a>` : ''}
          ${b.phone ? `<a class="biz-btn" href="tel:${b.phone}">📞 Appeler</a>` : ''}
          <button type="button" class="biz-btn" data-toggle-review="${b.id}">⭐ Avis</button>
        </div>
        <div class="review-panel" id="rev_${b.id}">
          ${reviews.length ? reviews.map(r=>`
            <div class="review-item">
              <div class="review-head"><span>${escapeHtml(r.name)}</span><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span></div>
              <div>${escapeHtml(r.comment)}</div>
            </div>
          `).join('') : '<div class="review-empty">Aucun avis pour le moment. Sois le premier à donner ton avis.</div>'}
          <div class="review-form">
            <input type="text" id="rn_${b.id}" placeholder="Ton prénom">
            <select id="rr_${b.id}">
              <option value="5">★★★★★ Excellent</option>
              <option value="4">★★★★☆ Très bien</option>
              <option value="3">★★★☆☆ Correct</option>
              <option value="2">★★☆☆☆ Décevant</option>
              <option value="1">★☆☆☆☆ Mauvais</option>
            </select>
            <textarea id="rc_${b.id}" placeholder="Ton commentaire…" rows="2"></textarea>
            <button type="button" data-submit-review="${b.id}">Publier mon avis</button>
          </div>
        </div>
      `;
      bizGrid.appendChild(card);
    });

    bizGrid.querySelectorAll('[data-toggle-review]').forEach(btn=>{
      btn.addEventListener('click', ()=> toggleReviewPanel(btn.dataset.toggleReview));
    });
    bizGrid.querySelectorAll('[data-submit-review]').forEach(btn=>{
      btn.addEventListener('click', ()=> submitReview(btn.dataset.submitReview));
    });
  }

  // ---------- FAQ accordéon ----------
  document.querySelectorAll('.faq-q').forEach(q=>{
    q.addEventListener('click', ()=>{
      q.parentElement.classList.toggle('open');
    });
  });

  // ---------- Upload logo (redimensionné côté client) ----------
  const logoInput = document.getElementById('f_logo');
  const logoPreview = document.getElementById('logoPreview');
  const logoHint = document.getElementById('logoHint');

  function resizeImageToBase64(file, callback){
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size/img.width, size/img.height);
        const w = img.width*scale, h = img.height*scale;
        ctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
        callback(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  if(logoInput){
    logoInput.addEventListener('change', ()=>{
      const file = logoInput.files[0];
      if(!file) return;
      if(file.size > 3 * 1024 * 1024){
        logoHint.textContent = 'Image trop lourde (max 3 Mo). Choisis-en une autre.';
        logoInput.value = '';
        return;
      }
      resizeImageToBase64(file, (dataUrl)=>{
        pendingLogo = dataUrl;
        logoPreview.innerHTML = `<img src="${pendingLogo}" alt="Aperçu du logo">`;
        logoHint.textContent = 'Logo prêt ✓';
      });
    });
  }

  // ---------- Formulaire d'inscription : géolocalisation ----------
  const geoStatus = document.getElementById('geoStatus');
  const geoBtn = document.getElementById('geoBtn');
  const manualCoords = document.getElementById('manualCoords');
  const manualToggle = document.getElementById('manualToggle');
  const fLat = document.getElementById('f_lat');
  const fLng = document.getElementById('f_lng');

  if(geoBtn){
    geoBtn.addEventListener('click', ()=>{
      if(!navigator.geolocation){
        geoStatus.textContent = 'Géolocalisation indisponible — utilise la saisie manuelle.';
        return;
      }
      geoStatus.textContent = 'Détection en cours…';
      navigator.geolocation.getCurrentPosition(
        pos=>{
          pendingLat = pos.coords.latitude;
          pendingLng = pos.coords.longitude;
          geoStatus.textContent = `Position détectée ✓ (${pendingLat.toFixed(4)}, ${pendingLng.toFixed(4)})`;
          geoStatus.classList.add('ok');
        },
        err=>{
          geoStatus.textContent = 'Position refusée — utilise la saisie manuelle ci-dessous.';
          manualCoords.classList.add('show');
        }
      );
    });
  }

  if(manualToggle){
    manualToggle.addEventListener('click', ()=>{
      manualCoords.classList.toggle('show');
    });
  }

  // ---------- Formulaire d'inscription : soumission ----------
  const bizForm = document.getElementById('bizForm');
  const submitBtn = document.getElementById('submitBtn');
  const formMsg = document.getElementById('formMsg');

  function showMsg(el, type, text){
    el.className = 'form-msg show ' + type;
    el.textContent = text;
  }

  if(bizForm){
    bizForm.addEventListener('submit', async (e)=>{
      e.preventDefault();

      const lat = pendingLat !== null ? pendingLat : (fLat.value ? parseFloat(fLat.value) : null);
      const lng = pendingLng !== null ? pendingLng : (fLng.value ? parseFloat(fLng.value) : null);

      if(lat === null || lng === null){
        showMsg(formMsg, 'error', "Ajoute ta position (bouton GPS ou coordonnées manuelles) pour apparaître dans le radar.");
        return;
      }

      const mgmtCode = genMgmtCode();
      const entry = {
        mgmtCode: mgmtCode,
        name: document.getElementById('f_name').value.trim(),
        category: document.getElementById('f_cat').value,
        phone: document.getElementById('f_phone').value.trim(),
        desc: document.getElementById('f_desc').value.trim(),
        addr: document.getElementById('f_addr').value.trim(),
        logo: pendingLogo,
        lat: lat,
        lng: lng,
        reviews: [],
        createdAt: Date.now()
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Inscription en cours…';

      try{
        const newId = await addBusinessToDb(entry);
        businesses.unshift({ id: newId, ...entry });
        formMsg.className = 'form-msg show success';
        formMsg.innerHTML = `${escapeHtml(entry.name)} est maintenant visible sur JRADAR !<br>Ton code de gestion (garde-le pour modifier ou supprimer ta fiche plus tard) :<div class="mgmt-code-box">${mgmtCode}</div>`;
        bizForm.reset();
        pendingLat = null; pendingLng = null; pendingLogo = null;
        geoStatus.textContent = 'Coordonnées GPS non détectées';
        geoStatus.classList.remove('ok');
        manualCoords.classList.remove('show');
        logoPreview.innerHTML = '🏢';
        logoHint.textContent = 'Image carrée conseillée, moins de 1 Mo.';
        renderChips();
        renderList();
        updateStats();
      }catch(err){
        console.error(err);
        showMsg(formMsg, 'error', "L'inscription a échoué. Vérifie ta connexion et réessaie.");
      }finally{
        submitBtn.disabled = false;
        submitBtn.textContent = 'Inscrire mon entreprise sur JRADAR';
      }
    });
  }

  // ---------- Mon espace : retrouver / modifier / supprimer sa fiche ----------
  const mgmtInput = document.getElementById('mgmtInput');
  const mgmtSearchBtn = document.getElementById('mgmtSearchBtn');
  const mgmtMsg = document.getElementById('mgmtMsg');
  const mgmtResult = document.getElementById('mgmtResult');

  function renderMgmtCard(biz){
    mgmtResult.innerHTML = `
      <div class="biz-card" style="margin-top:16px;">
        <div class="biz-top">
          <div class="biz-identity">
            ${biz.logo ? `<img class="biz-logo" src="${biz.logo}" alt="">` : `<div class="biz-logo">${CATEGORY_EMOJI[biz.category] || '📦'}</div>`}
            <div>
              <div class="biz-cat">${biz.category}</div>
              <div class="biz-name">${escapeHtml(biz.name)}</div>
            </div>
          </div>
        </div>
        <div class="biz-addr">📍 ${escapeHtml(biz.addr)}</div>
        <div class="biz-actions">
          <button type="button" class="biz-btn primary" id="editBizBtn">✏️ Modifier ma fiche</button>
          <button type="button" class="biz-btn" id="deleteBizBtn" style="border-color:#ff8a8a; color:#ff8a8a;">🗑️ Supprimer</button>
        </div>
      </div>
      <div id="editBizForm"></div>
    `;

    document.getElementById('deleteBizBtn').addEventListener('click', async ()=>{
      const confirmed = window.confirm(`Confirmer la suppression définitive de "${biz.name}" ? Cette action est irréversible.`);
      if(!confirmed) return;
      try{
        await deleteBusinessFromDb(biz.id);
        businesses = businesses.filter(b => b.id !== biz.id);
        renderChips();
        renderList();
        updateStats();
        mgmtResult.innerHTML = '';
        mgmtInput.value = '';
        showMsg(mgmtMsg, 'success', 'Ta fiche a été supprimée de JRADAR.');
      }catch(e){
        console.error(e);
        showMsg(mgmtMsg, 'error', 'La suppression a échoué. Réessaie.');
      }
    });

    document.getElementById('editBizBtn').addEventListener('click', ()=>{
      renderEditForm(biz);
    });
  }

  function renderEditForm(biz){
    const editZone = document.getElementById('editBizForm');
    const catOptions = CATEGORIES.filter(c=>c!=='Tous').map(c=>
      `<option value="${c}" ${c===biz.category?'selected':''}>${CATEGORY_EMOJI[c]||''} ${c}</option>`
    ).join('');

    editZone.innerHTML = `
      <div class="form-card" style="margin-top:14px;">
        <div class="field">
          <label>Logo</label>
          <div class="logo-upload-row">
            <div class="logo-preview" id="editLogoPreview">${biz.logo ? `<img src="${biz.logo}" alt="">` : (CATEGORY_EMOJI[biz.category]||'🏢')}</div>
            <input type="file" id="e_logo" accept="image/*">
          </div>
        </div>
        <div class="field"><label>Nom de l'entreprise</label><input type="text" id="e_name" value="${escapeHtml(biz.name)}"></div>
        <div class="field-row">
          <div class="field"><label>Catégorie</label><select id="e_cat">${catOptions}</select></div>
          <div class="field"><label>Téléphone</label><input type="tel" id="e_phone" value="${escapeHtml(biz.phone)}"></div>
        </div>
        <div class="field"><label>Description</label><textarea id="e_desc">${escapeHtml(biz.desc)}</textarea></div>
        <div class="field"><label>Adresse</label><input type="text" id="e_addr" value="${escapeHtml(biz.addr)}"></div>
        <button type="button" class="submit-btn" id="saveEditBtn">Enregistrer les modifications</button>
        <div class="form-msg" id="editMsg"></div>
      </div>
    `;

    let editedLogo = biz.logo || null;
    const eLogoInput = document.getElementById('e_logo');
    eLogoInput.addEventListener('change', ()=>{
      const file = eLogoInput.files[0];
      if(!file) return;
      resizeImageToBase64(file, (dataUrl)=>{
        editedLogo = dataUrl;
        document.getElementById('editLogoPreview').innerHTML = `<img src="${editedLogo}" alt="">`;
      });
    });

    document.getElementById('saveEditBtn').addEventListener('click', async ()=>{
      const updated = {
        name: document.getElementById('e_name').value.trim() || biz.name,
        category: document.getElementById('e_cat').value,
        phone: document.getElementById('e_phone').value.trim(),
        desc: document.getElementById('e_desc').value.trim(),
        addr: document.getElementById('e_addr').value.trim(),
        logo: editedLogo
      };
      const editMsg = document.getElementById('editMsg');
      try{
        await updateBusinessInDb(biz.id, updated);
        Object.assign(biz, updated);
        renderChips();
        renderList();
        showMsg(editMsg, 'success', 'Fiche mise à jour !');
        renderMgmtCard(biz);
      }catch(e){
        console.error(e);
        showMsg(editMsg, 'error', "La mise à jour a échoué. Réessaie.");
      }
    });
  }

  if(mgmtSearchBtn){
    mgmtSearchBtn.addEventListener('click', ()=>{
      const code = mgmtInput.value.trim().toUpperCase();
      mgmtResult.innerHTML = '';
      if(!code){
        showMsg(mgmtMsg, 'error', 'Entre ton code de gestion.');
        return;
      }
      const biz = businesses.find(b => b.mgmtCode === code);
      if(!biz){
        showMsg(mgmtMsg, 'error', 'Aucune entreprise trouvée avec ce code.');
        return;
      }
      mgmtMsg.className = 'form-msg';
      renderMgmtCard(biz);
    });
  }

  // ---------- Ouvrir le bon onglet si on arrive via un lien #discover / #register / #myspace ----------
  function applyHashTab(){
    const hash = window.location.hash.replace('#','');
    if(['discover','register','myspace'].includes(hash)){
      activateTab(hash);
    }
  }
  applyHashTab();

  // ---------- Page Avis (avis.html) ----------
  const avisFeed = document.getElementById('avisFeed');
  async function renderAvisFeed(){
    if(!avisFeed) return;
    let list = [];
    try{
      const snap = await db.collection('businesses').get();
      list = snap.docs.map(d => d.data());
    }catch(e){
      console.error('Erreur chargement avis', e);
    }

    let allReviews = [];
    list.forEach(b=>{
      (b.reviews || []).forEach(r=>{
        allReviews.push({ ...r, bizName: b.name, bizCategory: b.category });
      });
    });
    allReviews.sort((a,b)=> b.date - a.date);

    if(allReviews.length === 0){
      avisFeed.innerHTML = '<div class="empty-state">Aucun avis publié pour le moment. Les avis laissés sur les fiches entreprises apparaîtront ici.</div>';
      return;
    }

    avisFeed.innerHTML = allReviews.map(r=>`
      <div class="avis-card">
        <div class="avis-head">
          <div>
            <div class="avis-biz">${escapeHtml(r.bizName)}</div>
            <div class="avis-cat">${escapeHtml(r.bizCategory)}</div>
          </div>
          <div class="avis-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
        </div>
        <div class="avis-comment">${escapeHtml(r.comment)}</div>
        <div class="avis-author">— ${escapeHtml(r.name)}</div>
      </div>
    `).join('');
  }

  // ---------- Initialisation ----------
  loadBusinesses();
  requestUserLocation();
  trackVisit();
  renderAvisFeed();
})();
