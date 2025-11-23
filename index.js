import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle2, Terminal, Power, XCircle, ShieldAlert, Activity, Bug, Info, Eraser } from 'lucide-react';
import { Connection, LogEntry } from '../types';

// Logs simulando exatamente o erro do print (Timeout QR Code + Loop Sessão Zumbi)
const ERROR_LOGS: LogEntry[] = [
    { id: '1', timestamp: '17:35:01', level: 'info', message: '[conexão.atualização] { nomeDaSessão: "Adilson", conexão: "fechar", hasQR: falso }' },
    { id: '2', timestamp: '17:35:01', level: 'error', message: '🔴 Conexão fechada, reconectar? verdadeira sessão: Adilson' },
    { id: '3', timestamp: '17:35:11', level: 'warning', message: '⚠️ QR Code não disponível após 10 segundos para sessão Adilson' },
    { id: '4', timestamp: '17:35:12', level: 'info', message: '[start-session] Nova requisição: { sessionName: "Adilson", phoneNumber: "5518981092345" }' },
    { id: '5', timestamp: '17:35:12', level: 'info', message: 'ℹ️ Sessão já existe, retornando QR salvo: NÃO' },
    { id: '6', timestamp: '17:35:13', level: 'info', message: '[start-session] Nova requisição: { sessionName: "Adilson", ... }' },
    { id: '7', timestamp: '17:35:13', level: 'error', message: 'FATAL: Loop detectado. A sessão não consegue gerar QR novo pois acredita que já existe (Sessão Zumbi).' },
];

const MOCK_CONNECTIONS: Connection[] = [
  { id: '1', name: 'Adilson (Vendas)', phoneNumber: '+55 18 98109-2345', status: 'error', battery: 0, logs: ERROR_LOGS },
  { id: '2', name: 'Suporte N1', phoneNumber: '+55 11 99999-0002', status: 'connected', battery: 85, logs: [] },
  { id: '3', name: 'Financeiro', phoneNumber: '+55 11 98888-5555', status: 'connected', battery: 92, logs: [] },
];

export const ConnectionManager: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>(MOCK_CONNECTIONS);
  const [showQR, setShowQR] = useState(false);
  const [simulatingScan, setSimulatingScan] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>('1'); // Inicia aberto no erro

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (activeLogId && logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeLogId, connections]);

  const handleAddConnection = () => {
    setShowQR(true);
    setSimulatingScan(false);
  };

  const simulateSuccess = () => {
      setSimulatingScan(true);
      setTimeout(() => {
        const newConn: Connection = {
            id: Date.now().toString(),
            name: `Nova Conexão ${connections.length + 1}`,
            phoneNumber: '+55 11 98888-7777',
            status: 'connected',
            battery: 100,
            logs: [{ id: 'x', timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Conexão estabelecida com sucesso.' }]
        };
        setConnections([...connections, newConn]);
        setShowQR(false);
        setSimulatingScan(false);
    }, 2000);
  }

  const removeConnection = (id: string) => {
    if(confirm('Tem certeza? Isso apagará os dados da sessão.')) {
        setConnections(connections.filter(c => c.id !== id));
    }
  };

  const clearCacheAndReset = (id: string) => {
      // Simula a limpeza da pasta "auth_info" que resolve o problema Zumbi
      const updatedConns = connections.map(c => {
          if (c.id === id) {
              return { 
                  ...c, 
                  status: 'syncing' as const,
                  logs: [
                      ...c.logs || [],
                      { id: Date.now().toString(), timestamp: new Date().toLocaleTimeString(), level: 'warning', message: '🧹 Limpando Cache (Deletando pasta ./sessions/Adilson)...' },
                      { id: Date.now() + '1', timestamp: new Date().toLocaleTimeString(), level: 'info', message: '>> Aumentando Timeout QR para 40s...' },
                      { id: Date.now() + '2', timestamp: new Date().toLocaleTimeString(), level: 'info', message: '>> Reiniciando processo de autenticação...' },
                  ] as LogEntry[]
              };
          }
          return c;
      });
      setConnections(updatedConns);
      
      setTimeout(() => {
        setConnections(prev => prev.map(c => {
            if (c.id === id) {
                return { 
                    ...c, 
                    status: 'connected', 
                    battery: 100,
                    logs: [
                        ...c.logs || [],
                        { id: Date.now() + '3', timestamp: new Date().toLocaleTimeString(), level: 'info', message: '✅ QR Code gerado e lido com sucesso.' },
                        { id: Date.now() + '4', timestamp: new Date().toLocaleTimeString(), level: 'info', message: 'Cliente pronto.' },
                    ] as LogEntry[]
                };
            }
            return c;
        }));
      }, 3000);
  };

  return (
    <div className="flex-1 h-full bg-app-bg p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
           <div>
            <h1 className="text-3xl font-light text-gray-800 flex items-center gap-3">
                <Smartphone className="text-whatsapp-green" /> Gerenciador de Instâncias
            </h1>
            <p className="text-gray-500 mt-1">Monitoramento de sessões e status do Backend em tempo real.</p>
           </div>
           <button 
             onClick={handleAddConnection}
             className="bg-whatsapp-green text-white px-6 py-3 rounded-lg shadow hover:bg-emerald-600 flex items-center gap-2 transition-colors font-medium"
            >
             <Plus size={20} /> Nova Instância
           </button>
        </div>

        {/* QR Code Modal */}
        {showQR && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-white p-8 rounded-xl shadow-2xl flex flex-col items-center max-w-md w-full text-center relative">
                    <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><XCircle size={24}/></button>
                    
                    <h3 className="text-xl font-semibold mb-2 text-gray-800">Parear WhatsApp</h3>
                    <p className="text-sm text-gray-500 mb-6">Abra o WhatsApp no seu celular {'>'} Aparelhos conectados {'>'} Conectar aparelho</p>
                    
                    {!simulatingScan ? (
                        <>
                            <div className="w-64 h-64 bg-white mb-6 relative overflow-hidden rounded-lg border-4 border-gray-900 shadow-inner group cursor-pointer" onClick={simulateSuccess}>
                                <img src="https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=ZapCRM-System-Pairing-V2" alt="QR Code" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-green-500/20 to-transparent animate-scan" style={{height: '10%'}}></div>
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                                    <span className="text-white font-bold">Clique para Simular Leitura</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-full border border-orange-100">
                                <Activity size={14} />
                                <span>Ambiente de Demonstração (QR Code Ilustrativo)</span>
                            </div>
                        </>
                    ) : (
                        <div className="h-64 w-full flex flex-col items-center justify-center">
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-whatsapp-green border-t-transparent rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Smartphone className="text-gray-400" size={24} />
                                </div>
                            </div>
                            <h4 className="text-lg font-bold text-gray-700 mt-6">Autenticando Sessão...</h4>
                            <p className="text-gray-500 text-sm mt-1">Baixando mensagens e contatos</p>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Connections Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {connections.map(conn => (
                <div key={conn.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all ${conn.status === 'error' ? 'border-red-300 ring-4 ring-red-50 shadow-xl scale-[1.01]' : 'border-gray-200'}`}>
                    {/* Header Card */}
                    <div className="p-5 border-b border-gray-100 relative overflow-hidden">
                        {conn.status === 'error' && (
                             <div className="absolute top-0 left-0 w-full bg-red-600 text-white text-[10px] uppercase font-bold text-center py-1 animate-pulse">
                                Falha de Timeout (Sessão Zumbi)
                             </div>
                        )}
                        <div className={`flex justify-between items-start mb-2 ${conn.status === 'error' ? 'mt-4' : ''}`}>
                            <div>
                                <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                    {conn.name}
                                    {conn.status === 'error' && (
                                        <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] rounded-full font-bold uppercase tracking-wide flex items-center gap-1">
                                            <Bug size={10} /> QR Code Timeout
                                        </span>
                                    )}
                                </h3>
                                <p className="text-gray-500 text-sm font-mono mt-1">{conn.phoneNumber}</p>
                            </div>
                            
                            <div className={`w-3 h-3 rounded-full ${
                                conn.status === 'connected' ? 'bg-green-500 shadow-[0_0_0_4px_rgba(34,197,94,0.2)]' : 
                                conn.status === 'syncing' ? 'bg-yellow-400 animate-pulse' : 
                                'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.2)]'
                            }`}></div>
                        </div>
                        
                        {conn.status === 'error' ? (
                            <div className="mt-4 bg-red-50 p-3 rounded-lg border border-red-100 flex gap-3">
                                <AlertTriangle className="text-red-600 shrink-0" size={20} />
                                <div>
                                    <p className="text-xs font-bold text-red-800">QR Code não gerado a tempo</p>
                                    <p className="text-[11px] text-red-600 mt-0.5">O sistema expirou em 10s. É necessário limpar o cache da sessão.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4 mt-4 text-sm text-gray-600">
                                <div className="flex items-center gap-1.5" title="Bateria do Celular">
                                    <div className={`w-8 h-4 rounded border flex items-center px-0.5 ${conn.battery < 20 ? 'border-red-500 text-red-500' : 'border-gray-400 text-gray-600'}`}>
                                        <div className={`h-2.5 rounded-sm ${conn.battery < 20 ? 'bg-red-500' : 'bg-green-500'}`} style={{width: `${conn.battery}%`}}></div>
                                    </div>
                                    <span className="text-xs font-medium">{conn.battery}%</span>
                                </div>
                                <div className="w-px h-4 bg-gray-300"></div>
                                <div className="text-xs">
                                    Uptime: <span className="font-mono font-medium text-gray-800">14h 32m</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actions Toolbar */}
                    <div className="bg-gray-50 px-5 py-3 flex items-center justify-between gap-2 border-b border-gray-200">
                        <button 
                            onClick={() => setActiveLogId(activeLogId === conn.id ? null : conn.id)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-sm font-medium transition-colors ${activeLogId === conn.id ? 'bg-gray-800 text-white shadow-inner' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                        >
                            <Terminal size={16} />
                            {activeLogId === conn.id ? 'Ocultar Terminal' : 'Logs do Sistema'}
                        </button>
                        
                        {conn.status === 'error' ? (
                            <button 
                                onClick={() => clearCacheAndReset(conn.id)}
                                className="px-4 py-2 bg-red-600 text-white border border-red-700 rounded text-sm font-bold hover:bg-red-700 flex items-center gap-2 transition-colors shadow-md hover:shadow-lg animate-pulse"
                                title="Deletar pasta da sessão e tentar de novo"
                            >
                                <Eraser size={16} /> LIMPAR CACHE
                            </button>
                        ) : (
                            <button 
                                onClick={() => clearCacheAndReset(conn.id)}
                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded border border-transparent hover:border-blue-200 transition-colors"
                                title="Reiniciar Serviço"
                            >
                                <RefreshCw size={18} />
                            </button>
                        )}

                        <button 
                            onClick={() => removeConnection(conn.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded border border-transparent hover:border-red-200 transition-colors"
                        >
                            <Trash2 size={18} />
                        </button>
                    </div>

                    {/* Terminal View */}
                    {activeLogId === conn.id && (
                        <div className="bg-[#1e1e1e] p-4 font-mono text-xs overflow-hidden transition-all animate-in slide-in-from-top-2 border-t border-gray-800">
                            <div className="flex items-center justify-between text-gray-500 mb-2 pb-2 border-b border-gray-700">
                                <span className="flex items-center gap-2 text-green-500"><Activity size={12}/> Live Logs (Backend Stream)</span>
                                <span>PID: 4321</span>
                            </div>
                            <div className="h-48 overflow-y-auto space-y-1 pr-2 custom-scrollbar scroll-smooth">
                                {conn.logs && conn.logs.length > 0 ? conn.logs.map((log, idx) => (
                                    <div key={idx} className="flex gap-2 break-all font-mono">
                                        <span className="text-gray-500 shrink-0">[{log.timestamp}]</span>
                                        <span className={
                                            log.level === 'error' ? 'text-red-500 font-bold' : 
                                            log.level === 'warning' ? 'text-yellow-500' : 
                                            'text-blue-400'
                                        }>
                                            {log.level.toUpperCase()}
                                        </span>
                                        <span className="text-gray-300">{log.message}</span>
                                    </div>
                                )) : (
                                    <div className="text-gray-600 italic">Nenhum log recente.</div>
                                )}
                                <div ref={logsEndRef} />
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};
