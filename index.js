import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
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
const sessions = new Map();

// Função para iniciar ou recuperar uma sessão específica
async function startSession(sessionName) {
    try {
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

        // CONFIGURAÇÃO CRÍTICA DO SOCKET
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            // O Baileys precisa de um logger configurado corretamente
            logger: pino({ level: 'silent' }), 
            browser: Browsers.macOS("Chrome"),
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
                    console.error('Erro ao gerar QR visual:', err);
                }
            }

            if (connection === 'close') {
                // Tratamento seguro do código de erro
                const code = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;
                
                console.log(`[${sessionName}] Conexão fechada (${code}). Reconectando? ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    sessionData.status = 'reconectando';
                    // Delay exponencial simples para evitar flood
                    setTimeout(() => startSession(sessionName), 5000); 
                } else {
                    sessionData.status = 'desconectado';
                    sessionData.qrCode = null;
                    console.log(`[${sessionName}] Logout definitivo ou Sessão Inválida.`);
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

    } catch (error) {
        console.error(`ERRO FATAL ao iniciar sessão ${sessionName}:`, error);
        // Atualiza status para erro para o frontend saber
        if (sessions.has(sessionName)) {
            sessions.get(sessionName).status = 'erro_interno';
        }
        throw error; // Re-throw para o endpoint pegar
    }
}

// --- ROTAS DA API ---

// 1. Iniciar Sessão
app.post('/start-session', async (req, res) => {
    const { sessionName } = req.body;
    
    if (!sessionName) {
        return res.status(400).json({ error: 'sessionName é obrigatório' });
    }

    try {
        await startSession(sessionName);
        // Pequeno delay para dar tempo do socket iniciar e gerar QR (se necessário)
        setTimeout(() => {
            const data = sessions.get(sessionName);
            res.json({
                sessionName,
                status: data?.status || 'iniciando',
                qrCode: data?.qrCode
            });
        }, 3000);
    } catch (error) {
        console.error("Erro no endpoint start-session:", error);
        res.status(500).json({ error: error.message || "Erro interno ao iniciar WhatsApp" });
    }
});

// 2. Status
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

// 3. Logout
app.post('/logout', async (req, res) => {
    const { sessionName } = req.body;
    const session = sessions.get(sessionName);
    
    if (session && session.sock) {
        try {
            await session.sock.logout(); // Tenta logout limpo
        } catch (e) {
            console.warn("Erro ao fazer logout socket:", e);
        }
        
        sessions.delete(sessionName);
        
        // Limpeza física
        const authPath = path.join('auth_info', sessionName);
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
            } catch (err) {
                console.error("Erro ao apagar pasta:", err);
            }
        }
        
        res.json({ message: `Sessão ${sessionName} desconectada.` });
    } else {
        res.status(404).json({ error: 'Sessão não encontrada' });
    }
});

// --- DASHBOARD VISUAL (Raiz) ---
app.get('/', (req, res) => {
    try {
        const sessionsList = Array.from(sessions.entries()).map(([name, data]) => {
            let statusClass = 'iniciando';
            let statusText = data.status;

            if (data.status === 'connected') statusClass = 'connected';
            if (data.status === 'aguardando_leitura') statusClass = 'aguardando_leitura';
            if (data.status === 'reconectando') statusClass = 'reconectando';

            return `
                <div class="session-card">
                    <div class="card-header">
                        <h3>${name}</h3>
                        <form action="/logout" method="POST" style="display:inline" onsubmit="return confirm('Tem certeza?');">
                             <input type="hidden" name="sessionName" value="${name}">
                             <button type="submit" class="btn-delete" title="Apagar Sessão">X</button>
                        </form>
                    </div>
                    
                    <div class="status ${statusClass}">${statusText}</div>
                    
                    ${data.qrCode 
                        ? `<img src="${data.qrCode}" width="200" /><p class="instruction">Abra o WhatsApp > Aparelhos conectados > Conectar</p>` 
                        : data.status === 'connected' 
                            ? `<div class="icon">✅</div><p>Sessão Ativa</p>`
                            : `<div class="icon">⏳</div><p>Aguardando...</p>`
                    }
                </div>
            `;
        }).join('');

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>ZapCRM Manager</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #111b21; color: #e9edef; padding: 20px; margin: 0; }
                h1 { text-align: center; font-weight: 300; margin-bottom: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .controls { background: #202c33; padding: 20px; border-radius: 10px; margin-bottom: 30px; text-align: center; border: 1px solid #37404a; }
                .controls input { padding: 12px; border-radius: 6px; border: 1px solid #333; background: #2a3942; color: white; width: 60%; max-width: 300px; outline: none; }
                .controls button { padding: 12px 24px; background: #00a884; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
                .controls button:hover { background: #008f6f; }
                
                .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
                .session-card { background: #202c33; padding: 20px; border-radius: 10px; text-align: center; width: 280px; border: 1px solid #333; box-shadow: 0 4px 6px rgba(0,0,0,0.1); position: relative; }
                
                .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                .card-header h3 { margin: 0; font-size: 18px; }
                .btn-delete { background: #ef5350 !important; padding: 4px 10px !important; font-size: 12px; }
                
                .status { display: inline-block; padding: 4px 10px; border-radius: 99px; font-weight: bold; font-size: 11px; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 0.5px; }
                .connected { background: #00a88433; color: #00a884; }
                .aguardando_leitura { background: #ffc10733; color: #ffc107; }
                .reconectando { background: #2196f333; color: #2196f3; }
                .iniciando { background: #607d8b33; color: #cfd8dc; }
                
                .icon { font-size: 48px; margin: 20px 0; opacity: 0.8; }
                img { border-radius: 8px; border: 4px solid white; display: block; margin: 0 auto; }
                .instruction { color: #8696a0; font-size: 13px; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>ZapCRM Backend Manager</h1>
                
                <div class="controls">
                    <form action="/start-session" method="POST" onsubmit="event.preventDefault(); startNew(this);">
                        <input type="text" id="newSession" placeholder="Nome do Atendente (ex: Vendas)" required autocomplete="off" />
                        <button type="submit">➕ Nova Conexão</button>
                    </form>
                </div>

                <div class="grid">
                    ${sessionsList || '<p style="color:#8696a0; width: 100%; text-align: center;">Nenhuma sessão ativa. Crie uma acima para começar.</p>'}
                </div>
            </div>

            <script>
                async function startNew(form) {
                    const btn = form.querySelector('button');
                    const input = document.getElementById('newSession');
                    const name = input.value;
                    
                    if(!name) return;

                    btn.disabled = true;
                    btn.innerText = 'Criando...';
                    
                    try {
                        await fetch('/start-session', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ sessionName: name })
                        });
                        window.location.reload();
                    } catch (e) {
                        alert('Erro ao criar sessão: ' + e.message);
                        btn.disabled = false;
                        btn.innerText = '➕ Nova Conexão';
                    }
                }
                
                // Script simples para lidar com o delete via form normal sem JS complexo
                document.querySelectorAll('form[action="/logout"]').forEach(form => {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        if(!confirm('Tem certeza que deseja desconectar e apagar esta sessão?')) return;
                        
                        const formData = new FormData(form); // Pega o hidden input
                        // Precisamos converter FormData para JSON pq o endpoint espera JSON
                        const object = {};
                        formData.forEach((value, key) => object[key] = value);
                        
                        await fetch('/logout', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify(object)
                        });
                        window.location.reload();
                    });
                });
            </script>
        </body>
        </html>
        `;
        res.send(html);
    } catch (error) {
        console.error("Erro ao renderizar dashboard:", error);
        res.status(500).send("Erro interno ao renderizar painel: " + error.message);
    }
});

// Inicializa sessões salvas previamente no disco
const initSavedSessions = () => {
    try {
        if (fs.existsSync('auth_info')) {
            const dirs = fs.readdirSync('auth_info', { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            
            console.log(`Encontradas ${dirs.length} sessões salvas: ${dirs.join(', ')}`);
            dirs.forEach(name => startSession(name).catch(e => console.error(`Falha ao restaurar ${name}:`, e)));
        } else {
             // Cria a pasta base se não existir para evitar erros futuros
             fs.mkdirSync('auth_info', { recursive: true });
        }
    } catch (e) {
        console.error("Erro fatal ao ler sessões salvas:", e);
    }
};

app.listen(PORT, () => {
    console.log(`Server rodando na porta ${PORT}`);
    initSavedSessions();
});
