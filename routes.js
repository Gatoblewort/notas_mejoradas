const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

let db;
let io;
const setDb = (database) => { db = database; };
const setIo = (socketIo) => { io = socketIo; };

// ================================
// REGISTRO
// ================================
router.post('/register', async (req, res) => {
    const { nombre, email, contrasena } = req.body;
    if (!nombre || !email || !contrasena)
        return res.status(400).json({ error: 'Todos los campos son requeridos' });

    try {
        const hash = await bcrypt.hash(contrasena, 10);
        db.query(
            'INSERT INTO usuarios (nombre, email, contrasena) VALUES (?, ?, ?)',
            [nombre, email, hash],
            (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY')
                        return res.status(400).json({ error: 'El email ya está registrado' });
                    return res.status(500).json({ error: err.message });
                }
                res.json({ mensaje: '✅ Usuario registrado correctamente' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================
// LOGIN
// ================================
router.post('/login', (req, res) => {
    const { email, contrasena } = req.body;
    db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0)
            return res.status(401).json({ error: 'Usuario no encontrado' });

        const usuario = results[0];
        const passwordValida = await bcrypt.compare(contrasena, usuario.contrasena);
        if (!passwordValida)
            return res.status(401).json({ error: 'Contraseña incorrecta' });

        const token = jwt.sign(
            { id: usuario.id, nombre: usuario.nombre },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({
            mensaje: '✅ Login exitoso',
            token,
            usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email }
        });
    });
});

// ================================
// OBTENER NOTAS
// ================================
router.get('/notas', verificarToken, (req, res) => {
    const { categoria, prioridad, favorita } = req.query;
    let query = 'SELECT * FROM notas WHERE usuario_id = ?';
    const params = [req.usuario.id];

    if (categoria) { query += ' AND categoria = ?'; params.push(categoria); }
    if (prioridad) { query += ' AND prioridad = ?'; params.push(prioridad); }
    if (favorita === 'true') { query += ' AND favorita = 1'; }

    query += ' ORDER BY fecha DESC';

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ================================
// CREAR NOTA
// ================================
router.post('/notas', verificarToken, (req, res) => {
    const { titulo, contenido, color, prioridad, categoria, recordatorio } = req.body;
    db.query(
        'INSERT INTO notas (titulo, contenido, color, prioridad, categoria, recordatorio, fecha, usuario_id) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)',
        [titulo, contenido, color || 'blanco', prioridad || 'media', categoria || 'general', recordatorio || null, req.usuario.id],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (io) io.emit('nota_creada', { usuario_id: req.usuario.id });
            res.json({ mensaje: '✅ Nota creada', id: result.insertId });
        }
    );
});

// ================================
// EDITAR NOTA
// ================================
router.put('/notas/:id', verificarToken, (req, res) => {
    const { titulo, contenido, color, prioridad, categoria, recordatorio, favorita } = req.body;
    db.query(
        'UPDATE notas SET titulo=?, contenido=?, color=?, prioridad=?, categoria=?, recordatorio=?, favorita=? WHERE id=? AND usuario_id=?',
        [titulo, contenido, color, prioridad || 'media', categoria || 'general', recordatorio || null, favorita ? 1 : 0, req.params.id, req.usuario.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            if (io) io.emit('nota_actualizada', { usuario_id: req.usuario.id });
            res.json({ mensaje: '✅ Nota actualizada' });
        }
    );
});

// ================================
// TOGGLE FAVORITA
// ================================
router.patch('/notas/:id/favorita', verificarToken, (req, res) => {
    db.query(
        'UPDATE notas SET favorita = NOT favorita WHERE id = ? AND usuario_id = ?',
        [req.params.id, req.usuario.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            if (io) io.emit('nota_actualizada', { usuario_id: req.usuario.id });
            res.json({ mensaje: '✅ Favorita actualizada' });
        }
    );
});

// ================================
// ELIMINAR NOTA
// ================================
router.delete('/notas/:id', verificarToken, (req, res) => {
    db.query(
        'DELETE FROM notas WHERE id = ? AND usuario_id = ?',
        [req.params.id, req.usuario.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            if (io) io.emit('nota_eliminada', { usuario_id: req.usuario.id });
            res.json({ mensaje: '✅ Nota eliminada' });
        }
    );
});

// ================================
// SUBIR ARCHIVO
// ================================
router.post('/notas/:id/archivos', verificarToken, upload.single('archivo'), (req, res) => {
    const nota_id = req.params.id;
    const { originalname, mimetype, filename } = req.file;
    const ruta = `uploads/${filename}`;
    db.query(
        'INSERT INTO archivos (nota_id, nombre, tipo, ruta) VALUES (?, ?, ?, ?)',
        [nota_id, originalname, mimetype, ruta],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ mensaje: '✅ Archivo subido', archivo: { id: result.insertId, nombre: originalname, tipo: mimetype, ruta } });
        }
    );
});

// ================================
// OBTENER ARCHIVOS
// ================================
router.get('/notas/:id/archivos', verificarToken, (req, res) => {
    db.query('SELECT * FROM archivos WHERE nota_id = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ================================
// MIDDLEWARE
// ================================
function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch {
        res.status(401).json({ error: 'Token inválido' });
    }
}

module.exports = { router, setDb, setIo };