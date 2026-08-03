(function(){
  const STORAGE_KEY = 'jradar:businesses';
  let businesses = [];
  let userPos = null; // {lat, lng}
  let activeCategory = 'Tous';
  let searchTerm = '';
  let pendingLat = null, pendingLng = null;

  const CATEGORIES = ['Tous','Restauration','Beauté & bien-être','Santé','Commerce','Services pro','Éducation','Autre'];

  // ---------- Onglets ----------
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('section').forEach(s=>s.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // ---------- Points animés sur le radar du hero ----------
  const radarViz = document.getElementById('radarViz');
  for(let i=0;i<5;i++){
    const p = document.createElement('div');
    p.className = 'ping';
    const angle = Math.random()*Math.PI*2;
    const r = 30 + Math.random()*70;
    p.style.left = (110 + r*Math.cos(angle)) + 'px';
    p.style.top = (110 + r*Math.sin(angle)) + 'px';
    p.style.animationDelay = (Math.random()*2)+'s';
    radarViz.appendChild(p);
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

  // ---------- Stockage (persistant, partagé entre tous les visiteurs) ----------
  async function loadBusinesses(){
    try{
      const res = await window.storage.get(STORAGE_KEY, true);
      businesses = res && res.value ? JSON.parse(res.value) : [];
    }catch(e){
      businesses = [];
    }
    if(businesses.length === 0){
      businesses = seedData();
      await saveBusinesses();
    }
    renderChips();
    renderList();
  }

  async function saveBusinesses(){
    try{
      await window.storage.set(STORAGE_KEY, JSON.stringify(businesses), true);
    }catch(e){
      console.error('Erreur de sauvegarde', e);
    }
  }

  function seedData(){
    return [
      { id:'seed1', name:'Le Grill du Port', category:'Restauration', phone:'+22901539710', desc:'Grillades, poissons braisés et jus locaux. Ouvert midi et soir.', addr:'Akpakpa, Cotonou, Bénin', lat:6.3644, lng:2.4483, createdAt:Date.now() },
      { id:'seed2', name:'Amina Coiffure & Beauté', category:'Beauté & bien-être', phone:'+22996001122', desc:'Tresses, soins capillaires, manucure sur rendez-vous.', addr:'Fidjrossè, Cotonou, Bénin', lat:6.3550, lng:2.3850, createdAt:Date.now() },
      { id:'seed3', name:'Pharmacie Étoile', category:'Santé', phone:'+22997445566', desc:'Pharmacie de garde, conseils et livraison de médicaments.', addr:'Cadjehoun, Cotonou, Bénin', lat:6.3700, lng:2.3950, createdAt:Date.now() },
      { id:'seed4', name:'Atelier Textile Bénin', category:'Commerce', phone:'+22995223344', desc:'Tissus wax, confection sur mesure et accessoires.', addr:'Ganhi, Cotonou, Bénin', lat:6.3620, lng:2.4260, createdAt:Date.now() }
    ];
  }

  // ---------- Géolocalisation (page Découvrir) ----------
  const locBanner = document.getElementById('locBanner');
  const locStatus = document.getElementById('locStatus');
  const locBtn = document.getElementById('locBtn');

  function requestUserLocation(){
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
  locBtn.addEventListener('click', requestUserLocation);

  // ---------- Filtres ----------
  const chipsEl = document.getElementById('chips');
  function renderChips(){
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

  document.getElementById('searchInput').addEventListener('input', e=>{
    searchTerm = e.target.value.trim().toLowerCase();
    renderList();
  });

  // ---------- Affichage de la liste ----------
  const bizGrid = document.getElementById('bizGrid');
  function renderList(){
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
      bizGrid.innerHTML = '<div class="empty-state">Aucune entreprise ne correspond à ta recherche pour le moment.</div>';
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

      card.innerHTML = `
        <div class="biz-top">
          <div>
            <div class="biz-cat">${b.category}</div>
            <div class="biz-name">${escapeHtml(b.name)}</div>
          </div>
          ${b._dist !== null ? `<div class="biz-dist">${formatDist(b._dist)}</div>` : ''}
        </div>
        <div class="biz-desc">${escapeHtml(b.desc)}</div>
        <div class="biz-addr">📍 ${escapeHtml(b.addr)}</div>
        <div class="biz-actions">
          <a class="biz-btn" href="${mapsUrl}" target="_blank" rel="noopener">🗺️ Carte</a>
          ${phoneDigits ? `<a class="biz-btn primary" href="https://wa.me/${phoneDigits}?text=${waMsg}" target="_blank" rel="noopener">💬 Commander</a>` : ''}
          ${b.phone ? `<a class="biz-btn" href="tel:${b.phone}">📞 Appeler</a>` : ''}
        </div>
      `;
      bizGrid.appendChild(card);
    });
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- Formulaire d'inscription : géolocalisation ----------
  const geoStatus = document.getElementById('geoStatus');
  const geoBtn = document.getElementById('geoBtn');
  const manualCoords = document.getElementById('manualCoords');
  const manualToggle = document.getElementById('manualToggle');
  const fLat = document.getElementById('f_lat');
  const fLng = document.getElementById('f_lng');

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

  manualToggle.addEventListener('click', ()=>{
    manualCoords.classList.toggle('show');
  });

  // ---------- Formulaire d'inscription : soumission ----------
  const bizForm = document.getElementById('bizForm');
  const submitBtn = document.getElementById('submitBtn');
  const formMsg = document.getElementById('formMsg');

  bizForm.addEventListener('submit', async (e)=>{
    e.preventDefault();

    const lat = pendingLat !== null ? pendingLat : (fLat.value ? parseFloat(fLat.value) : null);
    const lng = pendingLng !== null ? pendingLng : (fLng.value ? parseFloat(fLng.value) : null);

    if(lat === null || lng === null){
      showMsg('error', "Ajoute ta position (bouton GPS ou coordonnées manuelles) pour apparaître dans le radar.");
      return;
    }

    const entry = {
      id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      name: document.getElementById('f_name').value.trim(),
      category: document.getElementById('f_cat').value,
      phone: document.getElementById('f_phone').value.trim(),
      desc: document.getElementById('f_desc').value.trim(),
      addr: document.getElementById('f_addr').value.trim(),
      lat: lat,
      lng: lng,
      createdAt: Date.now()
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Inscription en cours…';

    try{
      businesses.push(entry);
      await saveBusinesses();
      showMsg('success', `${entry.name} est maintenant visible sur JRADAR !`);
      bizForm.reset();
      pendingLat = null; pendingLng = null;
      geoStatus.textContent = 'Coordonnées GPS non détectées';
      geoStatus.classList.remove('ok');
      manualCoords.classList.remove('show');
      renderChips();
      renderList();
    }catch(err){
      businesses.pop();
      showMsg('error', "L'inscription a échoué. Réessaie dans un instant.");
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = 'Inscrire mon entreprise sur JRADAR';
    }
  });

  function showMsg(type, text){
    formMsg.className = 'form-msg show ' + type;
    formMsg.textContent = text;
  }

  // ---------- Initialisation ----------
  loadBusinesses();
  requestUserLocation();
})();
