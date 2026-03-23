const API = 'http://localhost:3000/api';
let token = localStorage.getItem('token');
let colorSeleccionado = 'amarillo';
let todasLasNotas = [];
let archivosSeleccionados = [];
let audioGrabado = null;
let mediaRecorder = null;
let grabadorTimer = null;
let grabadorSegundos = 0;
let notaActual = null;
let modoEdicion = false;
let filtroCategoria = 'todas';
let filtroPrioridad = 'todas';
let socket = null;

// ================================
// INICIO
// ================================
window.onload = () => {
    if (token) {
        const usuario = JSON.parse(localStorage.getItem('usuario'));
        mostrarApp(usuario);
        conectarSocket();
    } else {
        showLogin();
    }
};

// ================================
// WEBSOCKETS
// ================================
function conectarSocket() {
    socket = io();
    socket.on('nota_creada', () => cargarNotas());
    socket.on('nota_actualizada', () => cargarNotas());
    socket.on('nota_eliminada', () => cargarNotas());
}

// ================================
// NAVEGACIÓN
// ================================
function showLogin() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('loginScreen').classList.add('active');
}

function showRegister() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('registerScreen').classList.add('active');
}

function mostrarApp(usuario) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('appScreen').classList.add('active');

    const nombre = usuario.nombre;
    const inicial = nombre[0].toUpperCase();

    if (document.getElementById('userName')) document.getElementById('userName').textContent = nombre;
    if (document.getElementById('userAvatar')) document.getElementById('userAvatar').textContent = inicial;
    if (document.getElementById('userNameSide')) document.getElementById('userNameSide').textContent = nombre;
    if (document.getElementById('userAvatarSide')) document.getElementById('userAvatarSide').textContent = inicial;

    cargarNotas();
    verificarRecordatorios();
}

// ================================
// AUTH
// ================================
async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showToast('Completa todos los campos');

    try {
        const res = await fetch(`${API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, contrasena: password })
        });
        const data = await res.json();
        if (!res.ok) return showToast(data.error);

        token = data.token;
        localStorage.setItem('token', token);
        localStorage.setItem('usuario', JSON.stringify(data.usuario));
        mostrarApp(data.usuario);
        conectarSocket();
        showToast('¡Bienvenido ' + data.usuario.nombre + '!');
    } catch { showToast('Error de conexión'); }
}

async function register() {
    const nombre = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    if (!nombre || !email || !password) return showToast('Completa todos los campos');

    try {
        const res = await fetch(`${API}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, email, contrasena: password })
        });
        const data = await res.json();
        if (!res.ok) return showToast(data.error);
        showToast('¡Cuenta creada! Inicia sesión');
        showLogin();
    } catch { showToast('Error de conexión'); }
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    token = null;
    if (socket) socket.disconnect();
    showLogin();
}

// ================================
// CARGAR NOTAS
// ================================
async function cargarNotas() {
    try {
        const res = await fetch(`${API}/notas`, {
            headers: { 'authorization': token }
        });
        const notas = await res.json();

        for (let nota of notas) {
            const resA = await fetch(`${API}/notas/${nota.id}/archivos`, {
                headers: { 'authorization': token }
            });
            nota.archivos = await resA.json();
        }

        todasLasNotas = notas;
        aplicarFiltros();
        actualizarStats(notas);
    } catch { showToast('Error cargando notas'); }
}

function actualizarStats(notas) {
    const total = notas.length;
    const favoritas = notas.filter(n => n.favorita).length;
    const conArchivos = notas.filter(n => n.archivos && n.archivos.length > 0).length;

    ['totalNotas', 'totalNotasSide'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = total;
    });
    ['totalFavoritas', 'totalFavoritasSide'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = favoritas;
    });
    const ta = document.getElementById('totalArchivos');
    if (ta) ta.textContent = conArchivos;
}

// ================================
// FILTROS
// ================================
function filtrarCategoria(cat, btn) {
    filtroCategoria = cat;
    document.querySelectorAll('.filter-btn, .filter-chip, .nav-btn').forEach(b => {
        if (b.onclick && b.onclick.toString().includes('filtrarCategoria')) b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    aplicarFiltros();
}

function filtrarPrioridad(p, btn) {
    filtroPrioridad = p;
    document.querySelectorAll('.filter-btn').forEach(b => {
        if (b.onclick && b.onclick.toString().includes('filtrarPrioridad')) b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    aplicarFiltros();
}

function aplicarFiltros() {
    const termino = (document.getElementById('searchInput')?.value || '').toLowerCase();

    let filtradas = todasLasNotas.filter(nota => {
        const matchSearch = !termino ||
            nota.titulo.toLowerCase().includes(termino) ||
            (nota.contenido || '').toLowerCase().includes(termino);

        const matchCat = filtroCategoria === 'todas' ? true :
            filtroCategoria === 'favoritas' ? nota.favorita :
            nota.categoria === filtroCategoria;

        const matchPrioridad = filtroPrioridad === 'todas' ? true :
            nota.prioridad === filtroPrioridad;

        return matchSearch && matchCat && matchPrioridad;
    });

    renderizarPostits(filtradas);
}

function buscarNotas() { aplicarFiltros(); }

// ================================
// RENDERIZAR POST-ITS
// ================================
function renderizarPostits(notas) {
    const canvas = document.getElementById('postitCanvas');
    canvas.innerHTML = '';

    if (notas.length === 0) {
        canvas.innerHTML = `<div class="empty-state"><div class="icon">📝</div><p>No hay notas aquí</p><p style="font-size:12px;margin-top:5px">¡Crea tu primera nota!</p></div>`;
        return;
    }

    const esMobile = window.innerWidth <= 768;
    const posiciones = JSON.parse(localStorage.getItem('posicionesNotas') || '{}');

    notas.forEach((nota, i) => {
        const div = document.createElement('div');
        div.className = `postit ${nota.color || 'blanco'} ${nota.favorita ? 'favorita' : ''}`;
        div.dataset.id = nota.id;

        if (!esMobile) {
            const pos = posiciones[nota.id] || { x: 20 + (i % 4) * 220, y: 20 + Math.floor(i / 4) * 190 };
            div.style.left = pos.x + 'px';
            div.style.top = pos.y + 'px';
        }

        const imagen = nota.archivos?.find(a => a.tipo?.startsWith('image/'));
        const audio = nota.archivos?.find(a => a.tipo?.startsWith('audio/'));

        const prioridadBadge = nota.prioridad !== 'media' ?
            `<span class="badge ${nota.prioridad}">${nota.prioridad === 'alta' ? '🔴' : '🟢'}</span>` : '';
        const recordatorioBadge = nota.recordatorio ?
            `<span class="badge recordatorio">⏰</span>` : '';
        const favoritaBadge = nota.favorita ? `<span class="badge favorita">⭐</span>` : '';

        div.innerHTML = `
            <div class="postit-header">
                <h4>${escapeHtml(nota.titulo)}</h4>
                <button class="postit-delete" onclick="eliminarNotaRapido('${nota.id}', event)">🗑️</button>
            </div>
            <p>${escapeHtml(nota.contenido || '')}</p>
            ${imagen ? `<img class="postit-thumb" src="/${imagen.ruta}" onclick="abrirVisor('/${imagen.ruta}', event)">` : ''}
            ${audio ? `<audio class="postit-audio" controls src="/${audio.ruta}" onclick="event.stopPropagation()"></audio>` : ''}
            <div class="postit-footer">
                <span class="postit-date">${formatearFecha(nota.fecha)}</span>
                <div class="postit-badges">${prioridadBadge}${recordatorioBadge}${favoritaBadge}</div>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (!div.dataset.dragging) abrirNota(nota);
        });

        if (!esMobile) hacerArrastrable(div);
        canvas.appendChild(div);
    });
}

// ================================
// DRAG
// ================================
function hacerArrastrable(el) {
    let startX, startY, startLeft, startTop, dragging = false;

    const onStart = (e) => {
        if (['BUTTON', 'AUDIO', 'IMG'].includes(e.target.tagName)) return;
        e.preventDefault();
        dragging = false;
        const p = e.touches ? e.touches[0] : e;
        startX = p.clientX; startY = p.clientY;
        startLeft = parseInt(el.style.left) || 0;
        startTop = parseInt(el.style.top) || 0;
        el.style.zIndex = 100;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    };

    const onMove = (e) => {
        e.preventDefault();
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX;
        const dy = p.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragging = true;
        if (dragging) {
            el.dataset.dragging = 'true';
            el.style.left = (startLeft + dx) + 'px';
            el.style.top = (startTop + dy) + 'px';
        }
    };

    const onEnd = () => {
        el.style.zIndex = 1;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        if (dragging) {
            const posiciones = JSON.parse(localStorage.getItem('posicionesNotas') || '{}');
            posiciones[el.dataset.id] = { x: parseInt(el.style.left), y: parseInt(el.style.top) };
            localStorage.setItem('posicionesNotas', JSON.stringify(posiciones));
        }
        setTimeout(() => { delete el.dataset.dragging; }, 100);
    };

    el.addEventListener('mousedown', onStart);
    el.addEventListener('touchstart', onStart, { passive: false });
}

// ================================
// CREAR / EDITAR NOTA
// ================================
function abrirModal(nota = null) {
    modoEdicion = !!nota;
    notaActual = nota;

    document.getElementById('modalTitulo').textContent = nota ? 'Editar Nota' : 'Nueva Nota';
    document.getElementById('btnGuardar').textContent = nota ? '💾 Guardar cambios' : '💾 Guardar nota';
    document.getElementById('notaTitulo').value = nota ? nota.titulo : '';
    document.getElementById('notaContenido').value = nota ? (nota.contenido || '') : '';
    document.getElementById('notaCategoria').value = nota ? (nota.categoria || 'general') : 'general';
    document.getElementById('notaPrioridad').value = nota ? (nota.prioridad || 'media') : 'media';
    document.getElementById('notaRecordatorio').value = nota?.recordatorio ?
        new Date(nota.recordatorio).toISOString().slice(0, 16) : '';

    colorSeleccionado = nota ? (nota.color || 'amarillo') : 'amarillo';
    document.querySelectorAll('.color-dot').forEach(d => {
        d.classList.remove('active');
        if (d.classList.contains(colorSeleccionado)) d.classList.add('active');
    });

    archivosSeleccionados = [];
    audioGrabado = null;
    document.getElementById('archivosPreview').innerHTML = '';
    document.getElementById('grabadorAudio').style.display = 'none';
    document.getElementById('modal').classList.add('open');
}

function cerrarModal() {
    document.getElementById('modal').classList.remove('open');
    archivosSeleccionados = [];
    audioGrabado = null;
    document.getElementById('archivosPreview').innerHTML = '';
    document.getElementById('grabadorAudio').style.display = 'none';
    detenerGrabacion();
}

async function guardarNota() {
    const titulo = document.getElementById('notaTitulo').value.trim();
    const contenido = document.getElementById('notaContenido').value.trim();
    const categoria = document.getElementById('notaCategoria').value;
    const prioridad = document.getElementById('notaPrioridad').value;
    const recordatorio = document.getElementById('notaRecordatorio').value || null;

    if (!titulo) return showToast('Escribe un título');

    const body = { titulo, contenido, color: colorSeleccionado, categoria, prioridad, recordatorio };

    try {
        let res, data;
        if (modoEdicion && notaActual) {
            body.favorita = notaActual.favorita;
            res = await fetch(`${API}/notas/${notaActual.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'authorization': token },
                body: JSON.stringify(body)
            });
        } else {
            res = await fetch(`${API}/notas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'authorization': token },
                body: JSON.stringify(body)
            });
        }

        data = await res.json();
        if (!res.ok) return showToast(data.error);

        const notaId = modoEdicion ? notaActual.id : data.id;
        if (archivosSeleccionados.length > 0) await subirArchivos(notaId);
        if (audioGrabado) await subirAudioGrabado(notaId);

        cerrarModal();
        cargarNotas();
        showToast(modoEdicion ? '✅ Nota actualizada' : '✅ Nota guardada');
    } catch { showToast('Error guardando nota'); }
}

// ================================
// VER NOTA
// ================================
function abrirNota(nota) {
    notaActual = nota;

    document.getElementById('verTitulo').textContent = nota.titulo;
    document.getElementById('verContenido').textContent = nota.contenido || '';
    document.getElementById('verFecha').textContent = formatearFecha(nota.fecha);

    document.getElementById('verCategoria').textContent = `📌 ${nota.categoria || 'general'}`;
    document.getElementById('verPrioridad').textContent =
        nota.prioridad === 'alta' ? '🔴 Alta' :
        nota.prioridad === 'baja' ? '🟢 Baja' : '🟡 Media';
    document.getElementById('verRecordatorio').textContent =
        nota.recordatorio ? `⏰ ${formatearFecha(nota.recordatorio)}` : '';

    document.getElementById('btnFavorita').textContent =
        nota.favorita ? '⭐ Quitar favorita' : '☆ Agregar favorita';

    const archivosDiv = document.getElementById('verArchivos');
    archivosDiv.innerHTML = '';
    if (nota.archivos?.length > 0) {
        nota.archivos.forEach(a => {
            if (a.tipo?.startsWith('image/')) {
                archivosDiv.innerHTML += `<img src="/${a.ruta}" onclick="abrirVisor('/${a.ruta}', event)" style="width:100%;border-radius:10px;margin-top:8px;cursor:zoom-in">`;
            } else if (a.tipo?.startsWith('audio/')) {
                archivosDiv.innerHTML += `<audio controls src="/${a.ruta}" style="width:100%;margin-top:8px"></audio>`;
            } else {
                archivosDiv.innerHTML += `<a href="/${a.ruta}" target="_blank" style="display:block;margin-top:8px;color:var(--accent2)">📄 ${a.nombre}</a>`;
            }
        });
    }

    document.getElementById('modalNota').classList.add('open');
}

function cerrarModalNota() {
    document.getElementById('modalNota').classList.remove('open');
}

function activarEdicion() {
    cerrarModalNota();
    abrirModal(notaActual);
}

async function toggleFavoritaModal() {
    if (!notaActual) return;
    try {
        await fetch(`${API}/notas/${notaActual.id}/favorita`, {
            method: 'PATCH',
            headers: { 'authorization': token }
        });
        cargarNotas();
        cerrarModalNota();
        showToast('⭐ Favorita actualizada');
    } catch { showToast('Error'); }
}

async function eliminarNotaModal() {
    if (!notaActual || !confirm('¿Eliminar esta nota?')) return;
    await eliminarNota(notaActual.id);
    cerrarModalNota();
}

async function eliminarNotaRapido(id, event) {
    event.stopPropagation();
    if (!confirm('¿Eliminar esta nota?')) return;
    await eliminarNota(id);
}

async function eliminarNota(id) {
    try {
        await fetch(`${API}/notas/${id}`, {
            method: 'DELETE',
            headers: { 'authorization': token }
        });
        const posiciones = JSON.parse(localStorage.getItem('posicionesNotas') || '{}');
        delete posiciones[id];
        localStorage.setItem('posicionesNotas', JSON.stringify(posiciones));
        cargarNotas();
        showToast('Nota eliminada');
    } catch { showToast('Error eliminando nota'); }
}

// ================================
// ARCHIVOS
// ================================
function previewArchivo(input, tipo) {
    const file = input.files[0];
    if (!file) return;
    archivosSeleccionados.push({ file, tipo });
    const preview = document.getElementById('archivosPreview');
    const div = document.createElement('div');
    div.className = 'archivo-preview';
    if (tipo === 'imagen') {
        const url = URL.createObjectURL(file);
        div.innerHTML = `<img src="${url}"><span>${file.name}</span>`;
    } else {
        div.innerHTML = `<span>📄 ${file.name}</span>`;
    }
    preview.appendChild(div);
}

async function subirArchivos(notaId) {
    for (const { file } of archivosSeleccionados) {
        const formData = new FormData();
        formData.append('archivo', file);
        await fetch(`${API}/notas/${notaId}/archivos`, {
            method: 'POST',
            headers: { 'authorization': token },
            body: formData
        });
    }
    archivosSeleccionados = [];
}

// ================================
// GRABADOR
// ================================
function abrirGrabador() {
    const g = document.getElementById('grabadorAudio');
    g.style.display = g.style.display === 'none' ? 'block' : 'none';
}

async function iniciarGrabacion() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        const chunks = [];
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = () => {
            audioGrabado = new Blob(chunks, { type: 'audio/wav' });
            const url = URL.createObjectURL(audioGrabado);
            const audioEl = document.getElementById('audioGrabado');
            audioEl.src = url;
            audioEl.style.display = 'block';
            document.getElementById('grabadorStatus').textContent = '✅ Audio listo';
        };
        mediaRecorder.start();
        grabadorSegundos = 0;
        grabadorTimer = setInterval(() => {
            grabadorSegundos++;
            const m = Math.floor(grabadorSegundos / 60).toString().padStart(2, '0');
            const s = (grabadorSegundos % 60).toString().padStart(2, '0');
            document.getElementById('grabadorTiempo').textContent = `${m}:${s}`;
        }, 1000);
        document.getElementById('btnGrabar').disabled = true;
        document.getElementById('btnDetener').disabled = false;
        document.getElementById('grabadorStatus').textContent = '🔴 Grabando...';
    } catch { showToast('No se pudo acceder al micrófono'); }
}

function detenerGrabacion() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        clearInterval(grabadorTimer);
        document.getElementById('btnGrabar').disabled = false;
        document.getElementById('btnDetener').disabled = true;
    }
}

async function subirAudioGrabado(notaId) {
    if (!audioGrabado) return;
    const file = new File([audioGrabado], `audio_${Date.now()}.wav`, { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('archivo', file);
    await fetch(`${API}/notas/${notaId}/archivos`, {
        method: 'POST',
        headers: { 'authorization': token },
        body: formData
    });
    audioGrabado = null;
}

// ================================
// RECORDATORIOS
// ================================
function verificarRecordatorios() {
    setInterval(() => {
        const ahora = new Date();
        todasLasNotas.forEach(nota => {
            if (nota.recordatorio) {
                const rec = new Date(nota.recordatorio);
                const diff = rec - ahora;
                if (diff > 0 && diff < 60000) {
                    showToast(`⏰ Recordatorio: ${nota.titulo}`);
                }
            }
        });
    }, 30000);
}

// ================================
// VISOR IMAGEN
// ================================
function abrirVisor(src, event) {
    event.stopPropagation();
    document.getElementById('visorImg').src = src;
    document.getElementById('visorImagen').classList.add('open');
}

function cerrarVisor() {
    document.getElementById('visorImagen').classList.remove('open');
}

// ================================
// UTILIDADES
// ================================
function seleccionarColor(color, elemento) {
    colorSeleccionado = color;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    elemento.classList.add('active');
}

function toggleTheme() {
    const body = document.body;
    const isDark = body.classList.contains('dark-mode');
    body.classList.replace(isDark ? 'dark-mode' : 'light-mode', isDark ? 'light-mode' : 'dark-mode');
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.textContent = isDark ? '☀️' : '🌙';
    });
}

function formatearFecha(fecha) {
    if (!fecha) return '';
    return new Date(fecha).toLocaleDateString('es-MX', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(mensaje) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}