import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Armazenamento em memória das sessões ativas e seus QRs
const sessions = new Map(); 

// Logger para depuração
const logger = pino({ level: 'silent' }); // Silent para limpar o console do Railway

// --- ROTAS ---

// 1. Dashboard Visual (Para diagnóstico e Scan)
app.get('/', async (req, res) => {
  const activeSessions = Array.from(sessions.entries()).map(([name, data]) => ({
    name,
    status: data.status,
    qr: data.qrCode ? 'Disponível (Clique para ver)' : 'Não disponível',
    phone: data.user?.id?.split(':')[0] || 'Desconhecido'
  }));

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>ZapCRM Backend Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
        <meta http-equiv="refresh" content="5"> <!-- Auto refresh a cada 5s -->
      </head>
      <body class="bg-slate-900 text-white p-8 font-sans">
        <div class="max-w-4xl mx-auto">
          <div class="flex justify-between items-center mb-8">
            <h1 class="text-3xl font-bold text-emerald-400">ZapCRM Backend</h1>
            <span class="bg-blue-600 px-3 py-1 rounded text-sm">Online • Porta ${PORT}</span>
          </div>

          <div class="bg-slate-800 rounded-lg p-6 shadow-xl border border-slate-700">
            <h2 class="text-xl font-semibold mb-4 border-b border-slate-600 pb-2">Sessões Ativas (${activeSessions.length})</h2>
            
            ${activeSessions.length === 0 ? '<p class="text-gray-400 italic">Nenhuma sessão iniciada. O Frontend deve solicitar a conexão.</p>' : ''}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              ${activeSessions.map(s => `
                <div class="bg-slate-700 p-4 rounded-lg flex flex-col gap-2 relative group">
                  <div class="flex justify-between items-start">
                    <h3 class="font-bold text-lg">${s.name}</h3>
                    <span class="text-xs px-2 py-1 rounded ${s.status === 'connected' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">
                      ${s.status.toUpperCase()}
                    </span>
                  </div>
                  <p class="text-sm text-gray-300">📱 ${s.phone}</p>
                  
                  ${s.qr.includes('Disponível') ? `
                    <div class="mt-2 bg-white p-2 rounded w-fit mx-auto">
                       <img src="${sessions.get(s.name)?.qrCode}" class="w-32 h-32" />
                    </div>
                  ` : ''}

                  <button onclick="resetSession('${s.name}')" class="mt-2 text-xs text-red-400 hover:text-red-300 underline text-right">
                    Forçar Reset (Deletar Sessão)
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <script>
          async function resetSession(name) {
            if(!confirm('Isso vai derrubar a conexão e apagar os arquivos de sessão do ' + name + '. Continuar?')) return;
            try {
              await fetch('/reset-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionName: name })
              });
              alert('Sessão resetada. A página vai recarregar.');
              window.location.reload();
            } catch (e) {
              alert('Erro ao resetar: ' + e.message);
            }
          }
        </script>
      </body>
    </html>
  `;
  res.send(html);
});

// 2. Iniciar Sessão (Chamado pelo Frontend)
app.post('/start-session', async (req, res) => {
  const { sessionName } = req.body;
  
  if (!sessionName) {
    return res.status(400).json({ error: 'sessionName is required' });
  }

  // Se já existe e está conectado, retorna ok
  if (sessions.has(sessionName)) {
    const current = sessions.get(sessionName);
    if (current.status === 'connected') {
      return res.json({ status: 'connected', message: 'Sessão já ativa' });
    }
  }

  try {
    await startSession(sessionName);
    res.json({ status: 'initializing', message: 'Iniciando processo de autenticação...' });
  } catch (error) {
    console.error(`ERRO CRÍTICO ao iniciar ${sessionName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Status da Sessão (Polling do Frontend)
app.get('/session-status/:sessionName', (req, res) => {
  const { sessionName } = req.params;
  const session = sessions.get(sessionName);
  
  if (!session) {
    return res.json({ status: 'not_found' });
  }

  res.json({
    status: session.status,
    qrCode: session.qrCode, // Base64
    user: session.user
  });
});

// 4. Resetar Sessão (Útil para loops de conexão)
app.post('/reset-session', async (req, res) => {
  const { sessionName } = req.body;
  const authPath = path.resolve('auth_info', sessionName);

  // 1. Fechar socket se existir
  if (sessions.has(sessionName)) {
    const s = sessions.get(sessionName);
    if (s.sock) {
      s.sock.end(undefined);
    }
    sessions.delete(sessionName);
  }

  // 2. Apagar pasta
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    console.log(`[${sessionName}] Pasta de sessão apagada.`);
    res.json({ success: true });
  } catch (e) {
    console.error(`Erro ao apagar pasta ${sessionName}:`, e);
    res.status(500).json({ error: e.message });
  }
});


// --- LÓGICA DO BAILEYS ---

async function startSession(sessionName) {
  const authPath = path.resolve('auth_info', sessionName);
  
  // Cria a pasta se não existir
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  const sock = makeWASocket({
    auth: state, // <--- AQUI ESTAVA O ERRO: state e não sessionData
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false, // Otimização para carregar rápido
    connectTimeoutMs: 60000,
  });

  // Atualiza o Map de sessões
  sessions.set(sessionName, {
    sock,
    status: 'connecting',
    qrCode: null,
    user: null
  });

  // Evento: Credenciais atualizadas (Salvar sessão)
  sock.ev.on('creds.update', saveCreds);

  // Evento: Atualização de Conexão
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const sessionInfo = sessions.get(sessionName);

    if (qr) {
      console.log(`[${sessionName}] Novo QR Code gerado`);
      // Converter QR para Base64 para exibir no front
      const qrBase64 = await QRCode.toDataURL(qr);
      if (sessionInfo) {
        sessionInfo.qrCode = qrBase64;
        sessionInfo.status = 'scan_needed';
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[${sessionName}] Conexão fechada. Reconectar? ${shouldReconnect}`);
      
      if (shouldReconnect) {
        if (sessionInfo) sessionInfo.status = 'reconnecting';
        // Delay para evitar loops frenéticos
        setTimeout(() => startSession(sessionName), 3000);
      } else {
        console.log(`[${sessionName}] Desconectado permanentemente (Logged Out).`);
        if (sessionInfo) {
          sessionInfo.status = 'disconnected';
          sessions.delete(sessionName);
        }
        // Limpar pasta para permitir novo scan limpo
        try { fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
      }
    } else if (connection === 'open') {
      console.log(`[${sessionName}] CONEXÃO ESTABELECIDA!`);
      if (sessionInfo) {
        sessionInfo.status = 'connected';
        sessionInfo.qrCode = null; // Limpa QR
        sessionInfo.user = sock.user;
      }
    }
  });
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`);
  
  // Tentar restaurar sessões existentes na pasta auth_info ao iniciar
  const authRoot = path.resolve('auth_info');
  if (fs.existsSync(authRoot)) {
    const existingSessions = fs.readdirSync(authRoot).filter(f => fs.statSync(path.join(authRoot, f)).isDirectory());
    console.log(`Encontradas ${existingSessions.length} sessões salvas: ${existingSessions.join(', ')}`);
    
    existingSessions.forEach(sessionName => {
      console.log(`[${sessionName}] Tentando restaurar automaticamente...`);
      startSession(sessionName).catch(e => console.error(`Falha ao restaurar ${sessionName}:`, e));
    });
  }
});
