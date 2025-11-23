import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

// Configuração básica
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Armazenamento em memória das sessões ativas
// Estrutura: { [sessionName]: { sock: Socket, status: string, qrCode: string | null } }
const sessions = new Map();

// Função para iniciar ou recuperar uma sessão específica
async function startSession(sessionName) {
    // Se já estiver conectado, não faz nada
    if (sessions.has(sessionName) && sessions.get(sessionName).status === 'connected') {
        console.log(`[${sessionName}] Sessão já está online.`);
        return sessions.get(sessionName);
    }

    console.log(`[${sessionName}] Iniciando sessão...`);
    
    // Cria pasta específica para cada sessão (auth_info/nome_da_sessao)
    const authPath = path.join('auth_info', sessionName);
    if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS("Chrome"), // Simula Chrome no Mac para evitar desconexões
        connectTimeoutMs: 60000,
        syncFullHistory: false,
    });

    // Atualiza o estado na memória
    if (!sessions.has(sessionName)) {
        sessions.set(sessionName, { sock, status: 'iniciando', qrCode: null });
    } else {
        sessions.get(sessionName).sock = sock;
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const sessionData = sessions.get(sessionName);

        if (qr) {
            console.log(`[${sessionName}] Novo QR Code gerado`);
            try {
                sessionData.qrCode = await QRCode.toDataURL(qr);
                sessionData.status = 'aguardando_leitura';
            } catch (err) {
                console.error('Erro ao gerar QR:', err);
            }
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            
            console.log(`[${sessionName}] Conexão fechada (${code}). Reconectando? ${shouldReconnect}`);
            
            if (shouldReconnect) {
                sessionData.status = 'reconectando';
                setTimeout(() => startSession(sessionName), 3000); // Retry logic
            } else {
                sessionData.status = 'desconectado';
                sessionData.qrCode = null;
                console.log(`[${sessionName}] Logout definitivo.`);
                // Opcional: Apagar a pasta se for logout
                // fs.rmSync(authPath, { recursive: true, force: true });
                sessions.delete(sessionName);
            }
        } else if (connection === 'open') {
            console.log(`[${sessionName}] ✅ Conectado com sucesso!`);
            sessionData.status = 'connected';
            sessionData.qrCode = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sessionData;
}

// --- ROTAS DA API ---

// 1. Iniciar Sessão (Usado pelo Frontend)
app.post('/start-session', async (req, res) => {
    const { sessionName } = req.body;
    
    if (!sessionName) {
        return res.status(400).json({ error: 'sessionName é obrigatório' });
    }

    try {
        await startSession(sessionName);
        // Pequeno delay para dar tempo do QR ser gerado se for novo
        setTimeout(() => {
            const data = sessions.get(sessionName);
            res.json({
                sessionName,
                status: data?.status || 'iniciando',
                qrCode: data?.qrCode
            });
        }, 2000);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Status da Sessão Específica
app.get('/status/:sessionName', (req, res) => {
    const { sessionName } = req.params;
    const session = sessions.get(sessionName);
    
    if (!session) {
        return res.json({ status: 'offline', qrCode: null });
    }
    
    res.json({
        status: session.status,
        qrCode: session.qrCode
    });
});

// 3. Resetar/Logout de uma sessão
app.post('/logout', async (req, res) => {
    const { sessionName } = req.body;
    const session = sessions.get(sessionName);
    
    if (session && session.sock) {
        try {
            await session.sock.logout();
            sessions.delete(sessionName);
            const authPath = path.join('auth_info', sessionName);
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
            res.json({ message: `Sessão ${sessionName} desconectada.` });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao desconectar' });
        }
    } else {
        res.status(404).json({ error: 'Sessão não encontrada' });
    }
});

// --- DASHBOARD VISUAL (Raiz) ---
app.get('/', (req, res) => {
    // Gera HTML dinâmico listando todas as sessões ativas
    const sessionsList = Array.from(sessions.entries()).map(([name, data]) => {
        return `
            <div class="session-card">
                <h3>${name}</h3>
                <div class="status ${data.status}">${data.status}</div>
                ${data.qrCode 
                    ? `<img src="${data.qrCode}" width="200" /><p class="instruction">Leia o QR Code</p>` 
                    : data.status === 'connected' 
                        ? `<div class="icon">✅</div><p>Online</p>`
                        : `<div class="icon">⏳</div><p>Carregando...</p>`
                }
            </div>
        `;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>ZapCRM Multi-Device</title>
        <meta http-equiv="refresh" content="5">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: system-ui; background: #111b21; color: white; padding: 20px; }
            h1 { text-align: center; font-weight: 300; }
            .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
            .session-card { background: #202c33; padding: 20px; border-radius: 10px; text-align: center; width: 250px; border: 1px solid #333; }
            .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; margin-bottom: 10px; text-transform: uppercase; }
            .connected { background: #00a884; color: #fff; }
            .aguardando_leitura { background: #ffc107; color: #000; }
            .reconectando { background: #2196f3; }
            .iniciando { background: #607d8b; }
            .icon { font-size: 40px; margin: 20px 0; }
            img { border-radius: 8px; border: 5px solid white; }
            .instruction { color: #8696a0; font-size: 13px; }
            .controls { text-align: center; margin-bottom: 30px; }
            input { padding: 10px; border-radius: 5px; border: none; }
            button { padding: 10px 20px; background: #00a884; color: white; border: none; border-radius: 5px; cursor: pointer; }
        </style>
    </head>
    <body>
        <h1>ZapCRM Backend Manager</h1>
        <div class="controls">
            <form action="/start-session" method="POST" onsubmit="event.preventDefault(); startNew(this);">
                <input type="text" id="newSession" placeholder="Nome da Sessão (ex: Vendas)" required />
                <button type="submit">Criar Nova Sessão</button>
            </form>
        </div>
        <div class="grid">
            ${sessionsList || '<p style="color:#888">Nenhuma sessão ativa no momento.</p>'}
        </div>

        <script>
            async function startNew(form) {
                const name = document.getElementById('newSession').value;
                await fetch('/start-session', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ sessionName: name })
                });
                window.location.reload();
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Inicializa sessões salvas previamente no disco
const initSavedSessions = () => {
    if (fs.existsSync('auth_info')) {
        const dirs = fs.readdirSync('auth_info', { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        console.log(`Encontradas ${dirs.length} sessões salvas: ${dirs.join(', ')}`);
        dirs.forEach(name => startSession(name));
    }
};

app.listen(PORT, () => {
    console.log(`Server rodando na porta ${PORT}`);
    initSavedSessions();
});
