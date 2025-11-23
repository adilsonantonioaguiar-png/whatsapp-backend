// index.js - Backend WhatsApp Baileys para Railway
import express from 'express';
import cors from 'cors';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import P from 'pino';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Logger do Baileys
const logger = P({ level: 'info' });

// Armazena sessões ativas em memória
const sessions = new Map();

/**
 * Cria ou obtém uma sessão existente
 */
async function createOrGetSession(sessionName) {
  if (sessions.has(sessionName)) {
    return sessions.get(sessionName);
  }

  const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${sessionName}`);

  const sock = makeWASocket({
    logger,
    auth: state,
    printQRInTerminal: true,
  });

  let currentQR = null;
  let isConnected = false;
  let user = null;

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      logger.info({ sessionName }, 'Novo QR code gerado');
    }

    if (connection === 'open') {
      isConnected = true;
      user = sock.user;
      logger.info({ sessionName, user }, 'Sessão conectada');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      logger.warn({ sessionName, shouldReconnect }, 'Conexão fechada');
      if (!shouldReconnect) {
        sessions.delete(sessionName);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  const sessionData = { sock, currentQR, isConnected, user, sessionName };
  sessions.set(sessionName, sessionData);

  return sessionData;
}

/**
 * Rota de health check
 */
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'WhatsApp Baileys backend rodando' });
});

/**
 * Inicia sessão e retorna QR code
 */
app.post('/start-session', async (req, res) => {
  try {
    const { sessionName } = req.body;
    if (!sessionName) {
      return res.status(400).json({ error: 'sessionName é obrigatório' });
    }

    const session = await createOrGetSession(sessionName);

    // Espera até 15s por um QR code
    const start = Date.now();
    while (!session.currentQR && Date.now() - start < 15000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!session.currentQR && !session.isConnected) {
      return res.status(504).json({
        error: 'Timeout ao gerar QR code',
      });
    }

    const qrImage = await qrcode.toDataURL(session.currentQR || '');
    return res.json({
      qr: qrImage,
      connected: session.isConnected,
      user: session.user,
    });
  } catch (err) {
    logger.error({ err }, 'Erro em /start-session');
    return res.status(500).json({ error: 'Erro ao iniciar sessão' });
  }
});

/**
 * Status da sessão
 */
app.get('/status/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const session = sessions.get(sessionName);

    if (!session) {
      return res.json({ connected: false, message: 'Sessão não encontrada' });
    }

    return res.json({
      connected: session.isConnected,
      user: session.user,
    });
  } catch (err) {
    logger.error({ err }, 'Erro em /status');
    return res.status(500).json({ error: 'Erro ao obter status' });
  }
});

/**
 * Logout da sessão
 */
app.post('/logout/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const session = sessions.get(sessionName);

    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    await session.sock.logout();
    sessions.delete(sessionName);

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Erro em /logout');
    return res.status(500).json({ error: 'Erro ao fazer logout' });
  }
});

/**
 * Enviar mensagem
 */
app.post('/send-message', async (req, res) => {
  try {
    const { sessionName, number, message } = req.body;

    if (!sessionName || !number || !message) {
      return res.status(400).json({ error: 'sessionName, number e message são obrigatórios' });
    }

    const session = sessions.get(sessionName);

    if (!session || !session.isConnected) {
      return res.status(400).json({ error: 'Sessão não está conectada' });
    }

    const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
    await session.sock.sendMessage(jid, { text: message });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Erro em /send-message');
    return res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});
