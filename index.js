import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';

const app = express();
app.use(cors()); // Permite conexões do frontend
app.use(express.json());

const PORT = process.env.PORT || 3000;

let sock;
let qrCodeData = null;
let connectionStatus = 'disconnected';

// Função principal de conexão
async function connectToWhatsApp() {
    // Cria/Carrega a sessão na pasta 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' }), // Logs limpos
        browser: ["ZapCRM AI", "Chrome", "1.0.0"], // Nome que aparece no celular
        connectTimeoutMs: 60000,
    });

    // Monitora eventos de conexão
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'waiting_qr';
            console.log('QRCode recebido! Escaneie para conectar.');
        }

        if (connection === 'close') {
            // Verifica se deve reconectar automaticamente
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            
            connectionStatus = 'disconnected';
            qrCodeData = null;

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 2000); // Tenta reconectar em 2s
            }
        } else if (connection === 'open') {
            console.log('Conexão estabelecida com sucesso! 🚀');
            connectionStatus = 'connected';
            qrCodeData = null;
        }
    });

    // Salva as credenciais sempre que atualizarem
    sock.ev.on('creds.update', saveCreds);
}

// --- ROTAS DA API ---

// Rota de saúde (Health Check)
app.get('/', (req, res) => {
    res.json({ 
        message: 'Backend ZapCRM AI Ultra Online 🟢',
        status: connectionStatus
    });
});

// Rota para o Frontend pegar o Status e o QR Code
app.get('/status', async (req, res) => {
    let qrCodeImage = null;
    
    if (qrCodeData && connectionStatus === 'waiting_qr') {
        try {
            // Converte o código QR cru para uma imagem Base64 para exibir no navegador
            qrCodeImage = await QRCode.toDataURL(qrCodeData);
        } catch (err) {
            console.error('Erro ao gerar imagem do QR:', err);
        }
    }

    res.json({
        status: connectionStatus,
        qrCode: qrCodeImage, // Imagem para exibir
        qrRaw: qrCodeData    // Dados brutos
    });
});

// Rota para resetar a conexão (Logout forçado)
app.post('/reset', (req, res) => {
    try {
        if (sock) {
            sock.end(undefined);
        }
        // Remove a pasta de sessão
        if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }
        
        connectionStatus = 'disconnected';
        qrCodeData = null;
        
        // Reinicia o processo
        connectToWhatsApp();
        
        res.json({ message: 'Sessão resetada com sucesso. Gerando novo QR Code...' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao resetar sessão' });
    }
});

// Inicia o serviço
connectToWhatsApp();

app.listen(PORT, () => {
    console.log(`⚡ Servidor rodando na porta ${PORT}`);
});
