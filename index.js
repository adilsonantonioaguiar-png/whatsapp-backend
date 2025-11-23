import React, { useState, useEffect } from 'react';
import { Smartphone, Plus, Trash2, RefreshCw, CheckCircle2, Wifi, ShieldCheck, XCircle, Loader2 } from 'lucide-react';
import { Connection } from '../types';

// URL do Backend (ajuste se estiver rodando local ou em outra URL no Railway)
// Em produção, idealmente usar variável de ambiente ou caminho relativo se servido junto.
// Como é um app React separado, assumimos o proxy ou URL direta.
// Se der erro de CORS, verifique a URL.
const API_URL = 'http://localhost:8080'; // Ou a URL do seu Railway sem barra no final

export const ConnectionManager: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [loading, setLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline'>('offline');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Polling para atualizar lista de sessões
  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 3000); // Atualiza a cada 3s
    return () => clearInterval(interval);
  }, []);

  const fetchSessions = async () => {
    try {
      // Tenta usar caminho relativo primeiro (se proxy configurado) ou API_URL
      const response = await fetch('/sessions').catch(() => fetch(`${API_URL}/sessions`));
      
      if (response.ok) {
        const data = await response.json();
        setConnections(data.map((s: any) => ({
           id: s.id,
           name: s.name, // Nome da sessão é o ID visual
           phoneNumber: s.phoneNumber || '...',
           status: s.status === 'connected' ? 'connected' : s.status === 'scan_needed' ? 'disconnected' : 'syncing',
           battery: s.battery || 0,
           qrCode: s.qrCode, // Backend manda base64
           logs: []
        })));
        setBackendStatus('online');
        setLastUpdated(new Date());
      } else {
        setBackendStatus('offline');
      }
    } catch (e) {
      console.error("Erro ao buscar sessões:", e);
      setBackendStatus('offline');
    }
  };

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return;
    setLoading(true);
    try {
      await fetch('/start-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionName: newSessionName })
      }).catch(() => fetch(`${API_URL}/start-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionName: newSessionName })
      }));
      
      setNewSessionName('');
      setShowModal(false);
      // Força refresh imediato
      setTimeout(fetchSessions, 500);
    } catch (e) {
      alert('Erro ao criar sessão. Verifique se o backend está online.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSession = async (sessionName: string) => {
    if(!confirm(`Tem certeza que deseja apagar a sessão "${sessionName}"?`)) return;
    try {
        await fetch('/reset-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName })
        }).catch(() => fetch(`${API_URL}/reset-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName })
        }));
        setTimeout(fetchSessions, 500);
    } catch(e) {
        alert('Erro ao deletar sessão');
    }
  };

  return (
    <div className="flex-1 h-full bg-app-bg p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
           <div>
            <h1 className="text-3xl font-light text-gray-800 flex items-center gap-3">
                <Smartphone className="text-whatsapp-green" /> Gerenciador de Instâncias
            </h1>
            <p className="text-gray-500 mt-1">
                {connections.length} conexões ativas. Backend: <span className={backendStatus === 'online' ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{backendStatus.toUpperCase()}</span>
            </p>
           </div>
           
           <button 
                onClick={() => setShowModal(true)}
                disabled={backendStatus === 'offline'}
                className="bg-whatsapp-green text-white px-6 py-3 rounded-lg shadow hover:bg-emerald-600 flex items-center gap-2 transition-colors font-medium disabled:opacity-50"
            >
                <Plus size={20} /> Nova Instância
            </button>
        </div>

        {/* Modal de Criação */}
        {showModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in">
                <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-sm">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg text-gray-800">Nova Sessão</h3>
                        <button onClick={() => setShowModal(false)}><XCircle className="text-gray-400 hover:text-red-500"/></button>
                    </div>
                    <label className="block text-sm text-gray-600 mb-2">Nome do Atendente/Sessão</label>
                    <input 
                        type="text" 
                        value={newSessionName}
                        onChange={(e) => setNewSessionName(e.target.value)}
                        placeholder="Ex: Suporte, Vendas, Joao"
                        className="w-full border p-2 rounded mb-4 focus:ring-2 focus:ring-whatsapp-green outline-none"
                    />
                    <button 
                        onClick={handleCreateSession}
                        disabled={loading || !newSessionName}
                        className="w-full bg-whatsapp-green text-white py-2 rounded font-bold hover:bg-emerald-600 disabled:opacity-50 flex justify-center items-center gap-2"
                    >
                        {loading && <Loader2 className="animate-spin" size={16}/>}
                        Criar Sessão
                    </button>
                </div>
            </div>
        )}

        {/* Grid de Conexões */}
        {connections.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                <Smartphone size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-xl font-medium text-gray-500">Nenhuma instância ativa</h3>
                <p className="text-gray-400">Clique em "Nova Instância" para conectar um WhatsApp.</p>
            </div>
        ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {connections.map(conn => (
                    <div key={conn.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow relative">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-start">
                            <div>
                                <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                    {conn.name}
                                    {conn.status === 'connected' ? (
                                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] rounded-full font-bold uppercase flex items-center gap-1">
                                            <CheckCircle2 size={10} /> Online
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] rounded-full font-bold uppercase flex items-center gap-1">
                                            <RefreshCw size={10} className="animate-spin" /> {conn.status === 'syncing' ? 'Iniciando...' : 'Aguardando Scan'}
                                        </span>
                                    )}
                                </h3>
                                <p className="text-gray-500 text-sm font-mono mt-1">{conn.phoneNumber}</p>
                            </div>
                            <button onClick={() => handleDeleteSession(conn.name)} className="text-gray-400 hover:text-red-500 p-2" title="Remover Sessão">
                                <Trash2 size={18} />
                            </button>
                        </div>

                        {/* Área do QR Code ou Status */}
                        <div className="p-6 flex flex-col items-center justify-center bg-gray-50 min-h-[250px]">
                            {conn.status === 'connected' ? (
                                <div className="text-center">
                                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <ShieldCheck size={40} className="text-green-600" />
                                    </div>
                                    <h4 className="font-bold text-green-700">WhatsApp Conectado!</h4>
                                    <p className="text-sm text-gray-500 mt-2">Pronto para enviar e receber mensagens.</p>
                                </div>
                            ) : conn.qrCode ? (
                                <div className="text-center">
                                    <img src={conn.qrCode} alt="QR Code" className="w-48 h-48 border-4 border-white shadow-lg rounded-lg mx-auto" />
                                    <p className="text-xs text-gray-500 mt-4 animate-pulse">Escaneie com o WhatsApp</p>
                                </div>
                            ) : (
                                <div className="text-center flex flex-col items-center">
                                    <Loader2 size={32} className="animate-spin text-whatsapp-green mb-3" />
                                    <p className="text-gray-500">Gerando QR Code...</p>
                                    <p className="text-xs text-gray-400">Aguarde a inicialização do Baileys</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};
