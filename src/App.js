import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Grid, Trophy, RefreshCw, ChevronUp, ChevronDown, Minus, RotateCw, Settings, X, Clock, Hourglass, AlertTriangle } from 'lucide-react';

// Error boundary component
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Error caught by boundary:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="fixed inset-0 bg-red-900 flex items-center justify-center p-4">
                    <div className="text-center">
                        <h1 className="text-white text-2xl font-bold mb-4">Error Loading App</h1>
                        <p className="text-red-200 mb-6">{this.state.error?.message}</p>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null });
                                window.location.reload();
                            }}
                            className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600"
                        >
                            Reload
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

const ALLOWED_CREATOR_IDS = [
    '7444395575895719953',
    '7539826902857515009',
    '7514557708314542081',
    '7529074048186220545',
    '7514527995919646737',
    '7484173710891679761'
];

const INITIAL_DATA = {
    "data": {
        "anchorAnalysisDataInfos": [
            { "anchorBaseInfo": { "user_base_info": { "CreatorID": "7359135239559643141", "nickname": "Lannie👑💋", "display_id": "tranngoclan686", "avatar": "https://p16-sign-sg.tiktokcdn.com/tos-alisg-avt-0068/8649804393d5b8ec06eccf7f40c6d6a5~tplv-tiktokx-cropcenter:100:100.webp" } }, "income": { "current": 4354913 } },
            { "anchorBaseInfo": { "user_base_info": { "CreatorID": "7444395575895719953", "nickname": "Novix", "display_id": "novix.ht", "avatar": "https://p9-sign-sg.tiktokcdn.com/tos-alisg-avt-0068/2cc8f1d1a0c57248216c58f48913a90a~tplv-tiktokx-cropcenter:100:100.webp" } }, "income": { "current": 3007258 } },
            { "anchorBaseInfo": { "user_base_info": { "CreatorID": "7539826902857515009", "nickname": "DOPAMINE", "display_id": "dopamine.ht", "avatar": "https://p16-sign-sg.tiktokcdn.com/tos-alisg-avt-0068/45fafbe08fd9ef25d645d8903cb7a541~tplv-tiktokx-cropcenter:100:100.webp" } }, "income": { "current": 2282037 } },
        ]
    }
};

const Leaderboard = () => {
    // Initialize with safe defaults
    const [dataCache, setDataCache] = useState({ daily: [], monthly: [] });
    const [lastUpdated, setLastUpdated] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [rotation, setRotation] = useState(0);
    const [currentTime, setCurrentTime] = useState(new Date());

    // --- SETTINGS STATE ---
    const [showSettings, setShowSettings] = useState(false);
    const [config, setConfig] = useState({
        visibleTabs: { daily: true, monthly: true },
        showIncome: { daily: true, monthly: false },
        cycleDuration: 10,
        resetHour: 6, // Default reset hour
        footer: {
            enabled: true,
            showCycleTotal: true,
            showTimeLeft: true,
            showLastUpdate: true,
            showClock: true
        }
    });

    // --- VIEW STATE ---
    const [timeframe, setTimeframe] = useState('monthly');
    const [isInteracting, setIsInteracting] = useState(false);
    const [timeLeft, setTimeLeft] = useState(10);

    // --- RESPONSIVE LOGIC ---
    // Check if we are in portrait mode (90 or 270 degrees)
    const isPortrait = rotation % 180 !== 0;

    // --- SAFE UTILS ---
    const getSafeHostname = () => {
        if (window.location.hostname && window.location.hostname.length > 0) {
            return window.location.hostname;
        }
        try {
            const url = new URL(window.location.href);
            if (url.hostname) return url.hostname;
        } catch (e) { }

        return 'localhost';
    };

    const formatScore = (num) => {
        try {
            return new Intl.NumberFormat('en-US').format(num);
        } catch (e) {
            return num;
        }
    };

    // Function to process raw API data
    const processData = (rawData) => {
        if (!rawData?.data) return [];
        if (Array.isArray(rawData.data)) return rawData.data;

        if (rawData.data.anchorAnalysisDataInfos) {
            const filtered = rawData.data.anchorAnalysisDataInfos.filter(item =>
                ALLOWED_CREATOR_IDS.includes(item.anchorBaseInfo?.user_base_info?.CreatorID)
            );
            return filtered.map(item => ({
                id: item.anchorBaseInfo.user_base_info.CreatorID,
                name: item.anchorBaseInfo.user_base_info.nickname,
                username: item.anchorBaseInfo.user_base_info.display_id,
                avatar: item.anchorBaseInfo.user_base_info.avatar,
                score: item.income.current,
                trend: 'flat'
            })).sort((a, b) => b.score - a.score);
        }
        return [];
    };

    const fetchSingleType = async (type) => {
        // In production (served by Express), use relative URL
        // In development (CRA dev server), use the hostname:5000
        let serverUrl;
        if (process.env.NODE_ENV === 'production') {
            // Relative URL works because Express serves both frontend and API
            serverUrl = `/api/leaderboard?type=${type}&resetHour=${config.resetHour}`;
        } else {
            const hostname = getSafeHostname();
            serverUrl = `http://${hostname}:5000/api/leaderboard?type=${type}&resetHour=${config.resetHour}`;
        }

        const response = await fetch(serverUrl);
        if (!response.ok) throw new Error(`Server Error ${response.status}`);
        const json = await response.json();
        return processData(json);
    };

    const refreshAllData = async () => {
        setError(null);
        try {
            const [dailyData, monthlyData] = await Promise.all([
                fetchSingleType('daily').catch(err => {
                    console.warn("Daily fetch failed:", err);
                    return [];
                }),
                fetchSingleType('monthly').catch(err => {
                    console.warn("Monthly fetch failed:", err);
                    return [];
                })
            ]);

            const hasData = (Array.isArray(dailyData) && dailyData.length > 0) || (Array.isArray(monthlyData) && monthlyData.length > 0);

            if (hasData) {
                setDataCache({
                    daily: Array.isArray(dailyData) ? dailyData : [],
                    monthly: Array.isArray(monthlyData) ? monthlyData : []
                });
                setLastUpdated(new Date());
            } else {
                throw new Error('No data received from both endpoints');
            }
            setIsLoading(false);

        } catch (error) {
            console.error("Fetch error:", error);
            try {
                const mock = processData(INITIAL_DATA);
                setDataCache({ daily: mock, monthly: mock });
                setError(`Using Mock Data.`);
                setIsLoading(false);
            } catch (mockErr) {
                console.error("Mock data error:", mockErr);
                setIsLoading(false);
            }
        }
    };

    useEffect(() => {
        // Detect if running on TV and auto-rotate
        const detectTV = () => {
            const userAgent = navigator.userAgent.toLowerCase();
            const tvKeywords = ['webos', 'tizen', 'smarttv', 'nexus player', 'viera', 'bravia', 'fios', 'hbbtv', 'opera tv', 'samsung', 'lg tv', 'philips', 'sony', 'panasonic'];
            const isTv = tvKeywords.some(keyword => userAgent.includes(keyword));

            console.log('User Agent:', userAgent);
            console.log('Is TV:', isTv);

            if (isTv) {
                setRotation(90);
            }
        };

        detectTV();
    }, []);

    useEffect(() => {
        // Delay the initial fetch to avoid race conditions on mount
        const timer = setTimeout(() => {
            refreshAllData().catch(err => console.error("Initial refresh error:", err));
        }, 500);

        const intervalId = setInterval(() => {
            refreshAllData().catch(err => console.error("Interval refresh error:", err));
        }, 60000);

        return () => {
            clearTimeout(timer);
            clearInterval(intervalId);
        };
    }, [config.resetHour]); // Reload when resetHour changes

    useEffect(() => {
        const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(clockTimer);
    }, []);

    useEffect(() => {
        let interactionTimer;
        const handleInteraction = () => {
            setIsInteracting(true);
            clearTimeout(interactionTimer);
            interactionTimer = setTimeout(() => setIsInteracting(false), 1000);
        };

        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => window.addEventListener(event, handleInteraction));

        return () => {
            clearTimeout(interactionTimer);
            events.forEach(event => window.removeEventListener(event, handleInteraction));
        };
    }, []);

    useEffect(() => {
        setTimeLeft(config.cycleDuration);
    }, [config.cycleDuration]);

    // --- KEYBOARD SHORTCUTS FOR TV REMOTE ---
    useEffect(() => {
        const handleKeyPress = (e) => {
            const key = e.key;

            switch (key) {
                case '0':
                    // Rotate 90 degrees
                    setRotation(prev => (prev + 90) % 360);
                    break;
                case '1':
                    // Change to monthly
                    setTimeframe('monthly');
                    break;
                case '2':
                    // Change to daily
                    setTimeframe('daily');
                    break;
                case '3':
                    // Toggle income visibility for monthly
                    setConfig(prev => ({
                        ...prev,
                        showIncome: { ...prev.showIncome, monthly: !prev.showIncome.monthly }
                    }));
                    break;
                case '4':
                    // Toggle income visibility for daily
                    setConfig(prev => ({
                        ...prev,
                        showIncome: { ...prev.showIncome, daily: !prev.showIncome.daily }
                    }));
                    break;
                case '5':
                    // Toggle monthly tab visibility
                    setConfig(prev => ({
                        ...prev,
                        visibleTabs: { ...prev.visibleTabs, monthly: !prev.visibleTabs.monthly }
                    }));
                    break;
                case '6':
                    // Toggle daily tab visibility
                    setConfig(prev => ({
                        ...prev,
                        visibleTabs: { ...prev.visibleTabs, daily: !prev.visibleTabs.daily }
                    }));
                    break;
                case '7':
                    // Toggle settings modal
                    setShowSettings(prev => !prev);
                    break;
                case '8':
                    // Force refresh data
                    refreshAllData();
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [refreshAllData]);

    useEffect(() => {
        if (isInteracting) return;

        const { daily, monthly } = config.visibleTabs;
        if (!daily && !monthly) return;

        if (daily && !monthly && timeframe !== 'daily') {
            setTimeframe('daily');
            return;
        }
        if (!daily && monthly && timeframe !== 'monthly') {
            setTimeframe('monthly');
            return;
        }
        if ((daily && !monthly) || (!daily && monthly)) return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    setTimeframe(current => current === 'daily' ? 'monthly' : 'daily');
                    return config.cycleDuration;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);

    }, [isInteracting, config.visibleTabs, config.cycleDuration, timeframe]);


    const currentList = Array.isArray(dataCache[timeframe]) ? dataCache[timeframe] : [];
    const topThree = currentList.slice(0, 3);
    const restList = currentList.slice(3);

    const toggleConfig = (category, key) => {
        setConfig(prev => ({
            ...prev,
            [category]: { ...prev[category], [key]: !prev[category][key] }
        }));
    };

    const toggleFooterMaster = () => {
        setConfig(prev => ({ ...prev, footer: { ...prev.footer, enabled: !prev.footer.enabled } }));
    };

    const toggleFooterItem = (key) => {
        setConfig(prev => ({ ...prev, footer: { ...prev.footer, [key]: !prev.footer[key] } }));
    };

    const currentIncomeVisible = config.showIncome[timeframe];

    return (
        <div className="fixed inset-0 bg-[#181a3e] overflow-hidden font-sans">
            <div className={`
                absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                ${isPortrait ? 'w-[100vh] h-[100vw]' : 'w-full h-full'} 
                bg-[#181a3e] text-white flex flex-col items-center p-4 overflow-y-auto
                transition-all duration-500 ease-in-out
            `}
                style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
            >
                {/* Settings Modal */}
                {showSettings && (
                    <div className="absolute z-50 inset-0 bg-black/80 flex items-center justify-center p-4">
                        <div className="bg-[#252746] p-6 rounded-2xl w-full max-w-sm border border-gray-600 shadow-2xl max-h-[90vh] overflow-y-auto">
                            <div className="flex justify-between items-center mb-6 border-b border-gray-600 pb-2">
                                <h2 className="text-xl font-bold text-white">Settings</h2>
                                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
                            </div>
                            <div className="space-y-6">
                                {/* Settings content remains the same */}
                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Enabled Tabs</h3>
                                    <div className="flex gap-4">
                                        {['daily', 'monthly'].map(tab => (
                                            <label key={tab} className="flex items-center gap-2 cursor-pointer capitalize">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.visibleTabs[tab] ? 'bg-blue-500 border-blue-500' : 'border-gray-500'}`}>
                                                    {config.visibleTabs[tab] && <span className="text-white text-xs">✓</span>}
                                                </div>
                                                <input type="checkbox" className="hidden" checked={config.visibleTabs[tab]} onChange={() => toggleConfig('visibleTabs', tab)} />
                                                {tab}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Show Income Numbers</h3>
                                    <div className="flex gap-4">
                                        {['daily', 'monthly'].map(tab => (
                                            <label key={tab} className="flex items-center gap-2 cursor-pointer capitalize">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.showIncome[tab] ? 'bg-green-500 border-green-500' : 'border-gray-500'}`}>
                                                    {config.showIncome[tab] && <span className="text-white text-xs">✓</span>}
                                                </div>
                                                <input type="checkbox" className="hidden" checked={config.showIncome[tab]} onChange={() => toggleConfig('showIncome', tab)} />
                                                {tab}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Cycle Time (Seconds)</h3>
                                    <div className="flex items-center gap-3">
                                        <RefreshCw className="w-5 h-5 text-gray-400" />
                                        <input type="number" min="1" value={config.cycleDuration}
                                            onChange={(e) => setConfig(prev => ({ ...prev, cycleDuration: Math.max(1, parseInt(e.target.value) || 10) }))}
                                            className="w-full bg-[#181a3e] border border-gray-600 rounded-lg p-2 text-white focus:border-cyan-400 outline-none text-center font-mono"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Daily Reset Time (Hour)</h3>
                                    <div className="flex items-center gap-3">
                                        <Clock className="w-5 h-5 text-gray-400" />
                                        <input type="number" min="0" max="23" value={config.resetHour}
                                            onChange={(e) => setConfig(prev => ({ ...prev, resetHour: Math.max(0, Math.min(23, parseInt(e.target.value) || 0)) }))}
                                            className="w-full bg-[#181a3e] border border-gray-600 rounded-lg p-2 text-white focus:border-cyan-400 outline-none text-center font-mono"
                                        />
                                        <span className="text-gray-400 text-sm">h</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Updates leaderboard start time (0-23h)</p>
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">Footer Display</h3>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={config.footer.enabled} onChange={toggleFooterMaster} className="sr-only peer" />
                                            <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                                        </label>
                                    </div>
                                    <div className={`grid grid-cols-2 gap-2 ${!config.footer.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {['showCycleTotal', 'showTimeLeft', 'showLastUpdate', 'showClock'].map(key => (
                                            <label key={key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer capitalize">
                                                <input type="checkbox" checked={config.footer[key]} onChange={() => toggleFooterItem(key)} className="accent-blue-500" />
                                                {key.replace('show', '').replace(/([A-Z])/g, ' $1').trim()}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- HEADER (Conditional Sizing) --- */}
                <div className={`w-full flex justify-between items-center ${isPortrait ? 'max-w-3xl mb-6 mt-8' : 'max-w-lg mb-4 mt-2'}`}>
                    <div className="flex gap-4">
                        <button onClick={() => setRotation(prev => (prev + 90) % 360)} className={`hover:bg-white/10 rounded-full transition-colors ${isPortrait ? 'p-3' : 'p-2'}`}>
                            <RotateCw className={`${isPortrait ? 'w-8 h-8' : 'w-5 h-5'} text-blue-400`} />
                        </button>
                        <button onClick={() => setShowSettings(true)} className={`hover:bg-white/10 rounded-full transition-colors ${isPortrait ? 'p-3' : 'p-2'}`}>
                            <Settings className={`${isPortrait ? 'w-8 h-8' : 'w-5 h-5'} text-gray-400`} />
                        </button>
                    </div>
                    <h1 className={`${isPortrait ? 'text-4xl' : 'text-lg'} font-bold tracking-wide uppercase text-white bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 drop-shadow-lg`}>
                        Helios Leaderboard
                    </h1>
                    <div className={isPortrait ? "w-24" : "w-16"}></div>
                </div>

                {/* --- TABS (Conditional Sizing) --- */}
                <div className={`w-full bg-[#252746] rounded-2xl p-1 flex justify-between shadow-inner border border-gray-700 ${isPortrait ? 'max-w-3xl mb-8 p-2' : 'max-w-lg mb-4'}`}>
                    {config.visibleTabs.daily && (
                        <button onClick={() => setTimeframe('daily')} className={`flex-1 font-bold rounded-xl transition-all duration-300 ${isPortrait ? 'py-4 text-2xl' : 'py-2 text-sm'} ${timeframe === 'daily' ? 'bg-[#3a3d6e] text-white shadow-lg scale-[1.02]' : 'text-gray-400 hover:text-white'}`}>
                            DAILY
                        </button>
                    )}
                    {config.visibleTabs.monthly && (
                        <button onClick={() => setTimeframe('monthly')} className={`flex-1 font-bold rounded-xl transition-all duration-300 ${isPortrait ? 'py-4 text-2xl' : 'py-2 text-sm'} ${timeframe === 'monthly' ? 'bg-[#3a3d6e] text-white shadow-lg scale-[1.02]' : 'text-gray-400 hover:text-white'}`}>
                            MONTHLY
                        </button>
                    )}
                </div>

                {/* Error Banner */}
                {error && (
                    <div className={`w-full bg-red-900/50 border border-red-500 text-red-200 rounded-xl flex items-center gap-3 ${isPortrait ? 'max-w-3xl p-4 mb-6 text-lg' : 'max-w-lg p-2 mb-2 text-xs'}`}>
                        <AlertTriangle className={isPortrait ? "w-6 h-6" : "w-4 h-4"} flex-shrink-0 />
                        <span>{error}</span>
                    </div>
                )}

                {/* --- PODIUM (Conditional Sizing) --- */}
                {currentList.length > 0 ? (
                    <div className={`w-full flex justify-center items-end relative px-4 ${isPortrait ? 'max-w-4xl gap-6 mb-12' : 'max-w-lg gap-2 mb-6'}`}>
                        {/* Rank 2 */}
                        {topThree[1] && (
                            <div className={`flex flex-col items-center z-10 w-1/3 ${isPortrait ? '-mb-8' : '-mb-4'}`}>
                                <div className="relative group">
                                    <div className={`rounded-full border-cyan-400 bg-[#181a3e] overflow-hidden shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-transform group-hover:scale-105 duration-300 ${isPortrait ? 'w-52 h-52 border-[6px] p-2' : 'w-24 h-24 border-4 p-1'}`}>
                                        <img src={topThree[1].avatar} alt="" className="w-full h-full object-cover rounded-full" />
                                    </div>
                                    <div className={`absolute left-1/2 transform -translate-x-1/2 bg-cyan-500 rounded-full flex items-center justify-center font-bold shadow-xl border-[#181a3e] text-black ${isPortrait ? '-bottom-5 w-12 h-12 text-2xl border-[5px]' : '-bottom-3 w-6 h-6 text-xs border-2'}`}>2</div>
                                </div>
                                <div className={`text-center w-full ${isPortrait ? 'mt-8' : 'mt-2'}`}>
                                    <p className={`font-bold truncate w-full px-2 text-white drop-shadow-md ${isPortrait ? 'text-3xl' : 'text-sm'}`}>{topThree[1].name}</p>
                                    {currentIncomeVisible && <p className={`text-cyan-400 font-bold mt-1 ${isPortrait ? 'text-2xl' : 'text-xs'}`}>{formatScore(topThree[1].score)}</p>}
                                    <p className={`text-gray-400 truncate mt-1 ${isPortrait ? 'text-xl' : 'text-[10px]'}`}>@{topThree[1].username}</p>
                                </div>
                            </div>
                        )}
                        {/* Rank 1 */}
                        {topThree[0] && (
                            <div className={`flex flex-col items-center z-20 w-1/3 ${isPortrait ? 'mb-16' : 'mb-2'}`}>
                                <div className="relative group">
                                    <div className={`absolute left-1/2 transform -translate-x-1/2 drop-shadow-[0_0_15px_rgba(234,179,8,0.8)] ${isPortrait ? '-top-14' : '-top-8'}`}>
                                        <Trophy className={`${isPortrait ? 'w-20 h-20' : 'w-8 h-8'} text-yellow-400 fill-current animate-bounce`} />
                                    </div>
                                    <div className={`rounded-full border-yellow-400 bg-[#181a3e] overflow-hidden shadow-[0_0_50px_rgba(250,204,21,0.4)] transition-transform group-hover:scale-105 duration-300 ${isPortrait ? 'w-72 h-72 border-[8px] p-2' : 'w-32 h-32 border-4 p-1'}`}>
                                        <img src={topThree[0].avatar} alt="" className="w-full h-full object-cover rounded-full" />
                                    </div>
                                    <div className={`absolute left-1/2 transform -translate-x-1/2 bg-yellow-500 rounded-full flex items-center justify-center font-bold border-[#181a3e] shadow-xl text-black ${isPortrait ? '-bottom-8 w-16 h-16 text-3xl border-[6px]' : '-bottom-3 w-8 h-8 text-sm border-2'}`}>1</div>
                                </div>
                                <div className={`text-center w-full ${isPortrait ? 'mt-10' : 'mt-4'}`}>
                                    <p className={`font-black truncate w-full px-2 text-yellow-100 drop-shadow-lg ${isPortrait ? 'text-4xl' : 'text-lg'}`}>{topThree[0].name}</p>
                                    {currentIncomeVisible && <p className={`text-yellow-400 font-black mt-2 drop-shadow-md ${isPortrait ? 'text-3xl' : 'text-base'}`}>{formatScore(topThree[0].score)}</p>}
                                    <p className={`text-gray-400 truncate mt-1 ${isPortrait ? 'text-2xl' : 'text-xs'}`}>@{topThree[0].username}</p>
                                </div>
                            </div>
                        )}
                        {/* Rank 3 */}
                        {topThree[2] && (
                            <div className={`flex flex-col items-center z-10 w-1/3 ${isPortrait ? '-mb-8' : '-mb-4'}`}>
                                <div className="relative group">
                                    <div className={`rounded-full border-green-400 bg-[#181a3e] overflow-hidden shadow-[0_0_20px_rgba(74,222,128,0.3)] transition-transform group-hover:scale-105 duration-300 ${isPortrait ? 'w-52 h-52 border-[6px] p-2' : 'w-24 h-24 border-4 p-1'}`}>
                                        <img src={topThree[2].avatar} alt="" className="w-full h-full object-cover rounded-full" />
                                    </div>
                                    <div className={`absolute left-1/2 transform -translate-x-1/2 bg-green-500 rounded-full flex items-center justify-center font-bold shadow-xl border-[#181a3e] text-black ${isPortrait ? '-bottom-5 w-12 h-12 text-2xl border-[5px]' : '-bottom-3 w-6 h-6 text-xs border-2'}`}>3</div>
                                </div>
                                <div className={`text-center w-full ${isPortrait ? 'mt-8' : 'mt-2'}`}>
                                    <p className={`font-bold truncate w-full px-2 text-white drop-shadow-md ${isPortrait ? 'text-3xl' : 'text-sm'}`}>{topThree[2].name}</p>
                                    {currentIncomeVisible && <p className={`text-green-400 font-bold mt-1 ${isPortrait ? 'text-2xl' : 'text-xs'}`}>{formatScore(topThree[2].score)}</p>}
                                    <p className={`text-gray-400 truncate mt-1 ${isPortrait ? 'text-xl' : 'text-[10px]'}`}>@{topThree[2].username}</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center">
                        <p className="text-gray-400 text-xl animate-pulse">{isLoading ? 'Loading data...' : 'No data available'}</p>
                    </div>
                )}

                {/* --- LIST (Rank 4+) (Conditional Sizing) --- */}
                <div className={`w-full bg-[#252746] rounded-t-[3rem] flex-1 shadow-2xl overflow-y-auto min-h-[300px] ${isPortrait ? 'max-w-3xl px-6 py-8 mt-6' : 'max-w-lg px-4 py-4 mt-2'}`}>
                    <div className={`flex justify-between items-center mb-6 px-4 ${isPortrait ? 'mb-6' : 'mb-2'}`}>
                        <span className={`font-bold text-gray-400 uppercase tracking-widest ${isPortrait ? 'text-2xl' : 'text-xs'}`}>Rising Stars</span>
                        {isLoading && <RefreshCw className={`${isPortrait ? 'w-8 h-8' : 'w-4 h-4'} text-gray-400 animate-spin`} />}
                    </div>
                    <div className={`flex flex-col ${isPortrait ? 'gap-4' : 'gap-2'}`}>
                        {restList.map((anchor, index) => (
                            <div key={anchor.id} className={`flex items-center justify-between bg-[#202244] hover:bg-[#2e3155] transition border border-gray-700/50 shadow-md ${isPortrait ? 'p-5 rounded-3xl' : 'p-2 rounded-xl'}`}>
                                <div className={`flex items-center flex-1 min-w-0 ${isPortrait ? 'gap-6' : 'gap-3'}`}>
                                    <span className={`text-gray-400 font-bold text-center ${isPortrait ? 'w-12 text-3xl' : 'w-6 text-sm'}`}>{index + 4}</span>
                                    <div className={`rounded-full overflow-hidden border-2 border-gray-500 flex-shrink-0 ${isPortrait ? 'w-20 h-20 border-4' : 'w-10 h-10'}`}>
                                        <img src={anchor.avatar} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex flex-col min-w-0 justify-center">
                                        <span className={`font-bold text-white truncate ${isPortrait ? 'text-2xl' : 'text-sm'}`}>{anchor.name}</span>
                                        <span className={`text-gray-500 truncate mt-1 ${isPortrait ? 'text-lg' : 'text-[10px]'}`}>@{anchor.username}</span>
                                    </div>
                                </div>
                                <div className={`flex flex-col items-end pl-4 justify-center h-full`}>
                                    {currentIncomeVisible && (
                                        <>
                                            <span className={`font-bold text-white ${isPortrait ? 'text-2xl' : 'text-sm'}`}>{formatScore(anchor.score)}</span>
                                            <div className="flex items-center gap-1 mt-1">
                                                <span className={`text-gray-500 uppercase tracking-wide font-semibold ${isPortrait ? 'text-sm' : 'text-[8px]'}`}>Income</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- FOOTER (Conditional Sizing) --- */}
                {config.footer.enabled && (
                    <div className={`flex items-center gap-6 fixed bottom-4 bg-[#181a3e]/95 rounded-full backdrop-blur-md border border-gray-600 shadow-2xl z-40 ${isPortrait ? 'mt-6 text-lg px-8 py-3' : 'mt-2 text-[10px] px-4 py-1.5'}`}>
                        {config.footer.showCycleTotal && (
                            <div className="flex items-center gap-2">
                                <RefreshCw className={isPortrait ? "w-5 h-5" : "w-3 h-3"} />
                                <span>{config.cycleDuration}s</span>
                            </div>
                        )}
                        {config.footer.showTimeLeft && (
                            <div className={`flex items-center gap-2 font-semibold ${isInteracting ? 'text-yellow-500' : (timeLeft <= 3 ? 'text-yellow-400' : 'text-gray-300')}`}>
                                <Hourglass className={isPortrait ? "w-5 h-5" : "w-3 h-3"} />
                                <span>Next: {timeLeft}s</span>
                            </div>
                        )}
                        {config.footer.showLastUpdate && lastUpdated && (
                            <div className="hidden sm:flex items-center gap-2 border-l border-gray-600 pl-6">
                                <span>Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        )}
                        {config.footer.showClock && (
                            <div className={`flex items-center gap-2 border-l border-gray-600 pl-6 text-cyan-400 font-mono font-bold ${isPortrait ? 'text-xl' : 'text-xs'}`}>
                                <Clock className={isPortrait ? "w-5 h-5" : "w-3 h-3"} />
                                {currentTime.toLocaleTimeString()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function App() {
    return (
        <ErrorBoundary>
            <Leaderboard />
        </ErrorBoundary>
    );
}