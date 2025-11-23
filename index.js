import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let sock;
let currentQR = null; // Armazena a imagem base64 do QR
let connectionStatus = 'iniciando';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desativado para evitar logs poluídos e erros
        logger: pino({ level: 'silent' }),
        browser: ["ZapCRM", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        syncFullHistory: false, // Acelera o startup
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code recebido do WhatsApp');
            try {
                // Gera a imagem do QR Code para exibição
                currentQR = await QRCode.toDataURL(qr);
                connectionStatus = 'aguardando_leitura';
            } catch (err) {
                console.error('Erro ao gerar imagem QR:', err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexão fechada. Reconectando? ${shouldReconnect}`);
            
            if (shouldReconnect) {
                connectionStatus = 'reconectando';
                // Delay para evitar loop frenético
                setTimeout(connectToWhatsApp, 5000);
            } else {
                connectionStatus = 'desconectado_permanente';
                currentQR = null;
                console.log('Desconectado. Sessão encerrada.');
            }
        } else if (connection === 'open') {
            console.log('✅ Conexão estabelecida com sucesso!');
            connectionStatus = 'conectado';
            currentQR = null; // Limpa o QR pois já conectou
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// --- ROTA VISUAL (DIAGNÓSTICO) ---
app.get('/', (req, res) => {
    // Página HTML simples para ver o status e o QR Code direto no navegador
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>ZapCRM Backend</title>
        <meta http-equiv="refresh" content="5"> <!-- Atualiza a cada 5s -->
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, sans-serif; background: #111b21; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #202c33; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.3); max-width: 90%; width: 400px; }
            h1 { margin-bottom: 10px; font-weight: 300; }
            .status { font-weight: bold; padding: 5px 10px; border-radius: 4px; display: inline-block; margin-bottom: 20px; }
            .conectado { background: #00a884; color: white; }
            .aguardando_leitura { background: #ffc107; color: black; }
            .reconectando { background: #009de2; color: white; }
            img { border: 10px solid white; border-radius: 8px; margin-top: 10px; }
            p { color: #8696a0; font-size: 14px; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>ZapCRM Server</h1>
            <div class="status ${connectionStatus}">${connectionStatus.toUpperCase().replace('_', ' ')}</div>
            
            ${currentQR 
                ? `<br><img src="${currentQR}" width="250" alt="QR Code WhatsApp" /><br><p>Abra o WhatsApp > Aparelhos Conectados > Conectar Aparelho</p>` 
                : connectionStatus === 'conectado' 
                    ? `<br><div style="font-size: 50px;">✅</div><p>Sistema Online e Operante</p>`
                    : `<br><div style="font-size: 40px;">⏳</div><p>Gerando sessão...</p>`
            }
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// Rota JSON para o Frontend (React)
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qrCode: currentQR
    });
});

app.post('/reset', (req, res) => {
    try {
        if (sock) sock.end(undefined);
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }
        currentQR = null;
        connectionStatus = 'resetando';
        connectToWhatsApp();
        res.json({ message: 'Sessão resetada.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

connectToWhatsApp();

app.listen(PORT, () => {
    console.log(`Server rodando na porta ${PORT}`);
});
