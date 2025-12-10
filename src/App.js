import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Grid, Trophy, RefreshCw, ChevronUp, ChevronDown, Minus, RotateCw, Settings, X, Clock, Hourglass } from 'lucide-react';

const ALLOWED_CREATOR_IDS = [
    '7359135239559643141',
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
    // Instead of single 'anchors' list, we cache both types
    const [dataCache, setDataCache] = useState({ daily: [], monthly: [] });
    const [lastUpdated, setLastUpdated] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [rotation, setRotation] = useState(0);
    const [currentTime, setCurrentTime] = useState(new Date());
    
    // --- SETTINGS STATE ---
    const [showSettings, setShowSettings] = useState(false);
    const [config, setConfig] = useState({
        visibleTabs: { daily: true, monthly: true },
        showIncome: { daily: true, monthly: false },
        cycleDuration: 10, // seconds
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
    const [timeLeft, setTimeLeft] = useState(config.cycleDuration);

    // Function to process raw API data
    const processData = (rawData) => {
        if (!rawData?.data) {
            if (rawData?.data?.anchorAnalysisDataInfos) {
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
        }
        return rawData.data; 
    };

    // Fetch a single type (Internal helper)
    const fetchSingleType = async (type) => {
        const serverUrl = `http://${window.location.hostname}:5000/api/leaderboard?type=${type}`;
        const response = await fetch(serverUrl);
        if (!response.ok) throw new Error(`Server Error`);
        const json = await response.json();
        return processData(json);
    };

    // Main Fetch Function - Fetches BOTH Daily and Monthly in parallel
    const refreshAllData = async () => {
        // Only show loading on initial load (when cache is empty)
        if (dataCache.daily.length === 0 && dataCache.monthly.length === 0) {
            setIsLoading(true);
        }
        
        setError(null);
        try {
            // Execute both requests simultaneously
            const [dailyData, monthlyData] = await Promise.all([
                fetchSingleType('daily'),
                fetchSingleType('monthly')
            ]);

            setDataCache({
                daily: dailyData,
                monthly: monthlyData
            });
            setLastUpdated(new Date());

        } catch (error) {
            console.error("Fetch error:", error);
            // Only show error if we have NO data to show
            if (dataCache.daily.length === 0) {
                setError("Cannot connect to server. Ensure 'node server.js' is running.");
                // Fallback
                const mock = processData(INITIAL_DATA);
                setDataCache({ daily: mock, monthly: mock });
            }
        } finally {
            setIsLoading(false);
        }
    };

    // 1. Data Refresh Interval (every 60s)
    useEffect(() => {
        refreshAllData(); // Initial Load
        const intervalId = setInterval(refreshAllData, 60000); 
        return () => clearInterval(intervalId);
    }, []);

    // 2. Real-time Clock
    useEffect(() => {
        const clockTimer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(clockTimer);
    }, []);

    // 3. Interaction Monitor
    useEffect(() => {
        let interactionTimer;
        const handleInteraction = () => {
            setIsInteracting(true);
            clearTimeout(interactionTimer);
            interactionTimer = setTimeout(() => {
                setIsInteracting(false);
            }, 1000);
        };

        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => window.addEventListener(event, handleInteraction));

        return () => {
            clearTimeout(interactionTimer);
            events.forEach(event => window.removeEventListener(event, handleInteraction));
        };
    }, []);

    // 4. Smart Cycle Logic
    useEffect(() => {
        setTimeLeft(config.cycleDuration);
    }, [config.cycleDuration]);

    useEffect(() => {
        if (isInteracting) return;
        
        // Logic to handle enabled tabs
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
        if (daily && !monthly || !daily && monthly) return; // Single tab enabled, no cycling needed

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

    const formatScore = (num) => new Intl.NumberFormat('en-US').format(num);

    // Get anchors from cache immediately based on current timeframe
    // Defaults to empty array if cache isn't ready yet
    const anchors = dataCache[timeframe] || [];
    const topThree = anchors.slice(0, 3);
    const restList = anchors.slice(3);

    const toggleConfig = (category, key) => {
        setConfig(prev => ({
            ...prev,
            [category]: {
                ...prev[category],
                [key]: !prev[category][key]
            }
        }));
    };
    
    const toggleFooterMaster = () => {
        setConfig(prev => ({
            ...prev,
            footer: { ...prev.footer, enabled: !prev.footer.enabled }
        }));
    };

    const toggleFooterItem = (key) => {
        setConfig(prev => ({
            ...prev,
            footer: { ...prev.footer, [key]: !prev.footer[key] }
        }));
    };

    const currentIncomeVisible = config.showIncome[timeframe];

    return (
        <div className="fixed inset-0 bg-[#181a3e] overflow-hidden font-sans">
            <div className={`
                absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                ${(rotation % 180 !== 0) ? 'w-[100vh] h-[100vw]' : 'w-full h-full'} 
                bg-[#181a3e] text-white flex flex-col items-center p-4 overflow-y-auto
                transition-all duration-500 ease-in-out
            `}
            style={{ transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
            >
                {/* --- SETTINGS MODAL --- */}
                {showSettings && (
                    <div className="absolute z-50 inset-0 bg-black/80 flex items-center justify-center p-4">
                        <div className="bg-[#252746] p-6 rounded-2xl w-full max-w-sm border border-gray-600 shadow-2xl max-h-[90vh] overflow-y-auto">
                            <div className="flex justify-between items-center mb-6 border-b border-gray-600 pb-2">
                                <h2 className="text-xl font-bold text-white">Settings</h2>
                                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            
                            <div className="space-y-6">
                                {/* Settings Content (Same as before) */}
                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Enabled Tabs</h3>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.visibleTabs.daily ? 'bg-blue-500 border-blue-500' : 'border-gray-500'}`}>
                                                {config.visibleTabs.daily && <span className="text-white text-xs">✓</span>}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={config.visibleTabs.daily} onChange={() => toggleConfig('visibleTabs', 'daily')} />
                                            Daily
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.visibleTabs.monthly ? 'bg-blue-500 border-blue-500' : 'border-gray-500'}`}>
                                                {config.visibleTabs.monthly && <span className="text-white text-xs">✓</span>}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={config.visibleTabs.monthly} onChange={() => toggleConfig('visibleTabs', 'monthly')} />
                                            Monthly
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Show Income Numbers</h3>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.showIncome.daily ? 'bg-green-500 border-green-500' : 'border-gray-500'}`}>
                                                {config.showIncome.daily && <span className="text-white text-xs">✓</span>}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={config.showIncome.daily} onChange={() => toggleConfig('showIncome', 'daily')} />
                                            Daily
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${config.showIncome.monthly ? 'bg-green-500 border-green-500' : 'border-gray-500'}`}>
                                                {config.showIncome.monthly && <span className="text-white text-xs">✓</span>}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={config.showIncome.monthly} onChange={() => toggleConfig('showIncome', 'monthly')} />
                                            Monthly
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-cyan-400 mb-3 uppercase tracking-wider">Auto-Cycle Time (Seconds)</h3>
                                    <div className="flex items-center gap-3">
                                        <RefreshCw className="w-5 h-5 text-gray-400" />
                                        <input 
                                            type="number" 
                                            min="1"
                                            value={config.cycleDuration}
                                            onChange={(e) => setConfig(prev => ({...prev, cycleDuration: Math.max(1, parseInt(e.target.value) || 10)}))}
                                            className="w-full bg-[#181a3e] border border-gray-600 rounded-lg p-2 text-white focus:border-cyan-400 outline-none text-center font-mono"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">Footer Display</h3>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" checked={config.footer.enabled} onChange={toggleFooterMaster} className="sr-only peer" />
                                            <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                    </div>
                                    
                                    <div className={`grid grid-cols-2 gap-2 ${!config.footer.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                            <input type="checkbox" checked={config.footer.showCycleTotal} onChange={() => toggleFooterItem('showCycleTotal')} className="accent-blue-500" />
                                            Cycle Total
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                            <input type="checkbox" checked={config.footer.showTimeLeft} onChange={() => toggleFooterItem('showTimeLeft')} className="accent-blue-500" />
                                            Time Left
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                            <input type="checkbox" checked={config.footer.showLastUpdate} onChange={() => toggleFooterItem('showLastUpdate')} className="accent-blue-500" />
                                            Last Update
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                            <input type="checkbox" checked={config.footer.showClock} onChange={() => toggleFooterItem('showClock')} className="accent-blue-500" />
                                            Real Clock
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Header */}
                <div className="w-full max-w-lg flex justify-between items-center mb-4 mt-4">
                    <div className="flex gap-2">
                        <button onClick={() => setRotation(prev => (prev + 90) % 360)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><RotateCw className="w-6 h-6 text-blue-400" /></button>
                        <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><Settings className="w-6 h-6 text-gray-400" /></button>
                    </div>
                    <h1 className="text-xl font-bold tracking-wide">Agency Leaderboard</h1>
                    <div className="w-20"></div> {/* Spacer */}
                </div>

                {/* Tabs */}
                <div className="w-full max-w-lg bg-[#252746] rounded-xl p-1 flex justify-between mb-6 shadow-inner">
                    {config.visibleTabs.daily && (
                        <button 
                            onClick={() => setTimeframe('daily')}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${timeframe === 'daily' ? 'bg-[#3a3d6e] text-white shadow-md scale-105' : 'text-gray-400 hover:text-white'}`}
                        >
                            Daily
                        </button>
                    )}
                    {config.visibleTabs.monthly && (
                        <button 
                            onClick={() => setTimeframe('monthly')}
                            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-300 ${timeframe === 'monthly' ? 'bg-[#3a3d6e] text-white shadow-md scale-105' : 'text-gray-400 hover:text-white'}`}
                        >
                            Monthly
                        </button>
                    )}
                </div>

                {/* Error Message */}
                {error && (
                    <div className="w-full max-w-lg bg-red-900/50 border border-red-500 text-red-200 p-3 rounded-lg mb-4 text-xs">
                        {error}
                    </div>
                )}

                {/* Top 3 Podium Area */}
                {anchors.length > 0 ? (
                <div className="w-full max-w-lg flex justify-center items-end gap-2 mb-6 relative px-2">
                    
                    {/* 2nd Place */}
                    {topThree[1] && (
                        <div className="flex flex-col items-center z-10 -mb-4 w-1/3">
                            <div className="relative">
                                <div className="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-cyan-400 p-1 bg-[#181a3e] overflow-hidden">
                                    <img src={topThree[1].avatar} alt={topThree[1].name} className="w-full h-full object-cover rounded-full" />
                                </div>
                                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-cyan-500 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-lg">
                                    2
                                </div>
                            </div>
                            <div className="mt-4 text-center w-full">
                                <p className="font-semibold text-sm truncate w-full px-2">{topThree[1].name}</p>
                                {currentIncomeVisible && <p className="text-cyan-400 text-sm font-bold">{formatScore(topThree[1].score)}</p>}
                                <p className="text-[10px] text-gray-500 truncate">@{topThree[1].username}</p>
                            </div>
                        </div>
                    )}

                    {/* 1st Place */}
                    {topThree[0] && (
                        <div className="flex flex-col items-center z-20 mb-4 w-1/3">
                            <div className="relative">
                                <div className="absolute -top-10 left-1/2 transform -translate-x-1/2">
                                    <Trophy className="w-10 h-10 text-yellow-400 fill-current animate-bounce" />
                                </div>
                                <div className="w-28 h-28 md:w-32 md:h-32 rounded-full border-4 border-yellow-400 p-1 bg-[#181a3e] overflow-hidden shadow-[0_0_20px_rgba(250,204,21,0.3)]">
                                    <img src={topThree[0].avatar} alt={topThree[0].name} className="w-full h-full object-cover rounded-full" />
                                </div>
                                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-yellow-500 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 border-[#181a3e] shadow-lg">
                                    1
                                </div>
                            </div>
                            <div className="mt-5 text-center w-full">
                                <p className="font-bold text-lg truncate w-full px-2">{topThree[0].name}</p>
                                {currentIncomeVisible && <p className="text-yellow-400 text-lg font-bold">{formatScore(topThree[0].score)}</p>}
                                <p className="text-xs text-gray-500 truncate">@{topThree[0].username}</p>
                            </div>
                        </div>
                    )}

                    {/* 3rd Place */}
                    {topThree[2] && (
                        <div className="flex flex-col items-center z-10 -mb-4 w-1/3">
                            <div className="relative">
                                <div className="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-green-400 p-1 bg-[#181a3e] overflow-hidden">
                                    <img src={topThree[2].avatar} alt={topThree[2].name} className="w-full h-full object-cover rounded-full" />
                                </div>
                                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-green-500 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-lg">
                                    3
                                </div>
                            </div>
                            <div className="mt-4 text-center w-full">
                                <p className="font-semibold text-sm truncate w-full px-2">{topThree[2].name}</p>
                                {currentIncomeVisible && <p className="text-green-400 text-sm font-bold">{formatScore(topThree[2].score)}</p>}
                                <p className="text-[10px] text-gray-500 truncate">@{topThree[2].username}</p>
                            </div>
                        </div>
                    )}
                </div>
                ) : (
                    <div className="h-64 flex items-center justify-center">
                        <p className="text-gray-400 animate-pulse">Loading data...</p>
                    </div>
                )}

                {/* List for Rank 4+ */}
                <div className="w-full max-w-lg bg-[#252746] rounded-t-3xl flex-1 px-4 py-6 mt-4 shadow-2xl overflow-y-auto min-h-[300px]">
                    <div className="flex justify-between items-center mb-4 px-2">
                        <span className="text-sm font-semibold text-gray-400">Rest of the Best</span>
                        {isLoading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
                    </div>
                    
                    <div className="flex flex-col gap-3">
                        {restList.map((anchor, index) => (
                            <div key={anchor.id} className="flex items-center justify-between p-3 bg-[#202244] hover:bg-[#2e3155] rounded-xl transition border border-gray-700/50">
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <span className="text-gray-400 font-bold w-6 text-center text-lg">{index + 4}</span>
                                    <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-600 flex-shrink-0">
                                        <img src={anchor.avatar} alt={anchor.name} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-semibold text-sm text-white truncate">{anchor.name}</span>
                                        <span className="text-xs text-gray-500 truncate">@{anchor.username}</span>
                                    </div>
                                </div>
                                
                                <div className="flex flex-col items-end pl-2">
                                    {currentIncomeVisible && (
                                        <>
                                            <span className="font-bold text-white text-base">{formatScore(anchor.score)}</span>
                                            <div className="flex items-center gap-1">
                                                <span className="text-[10px] text-gray-500">Income</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                {/* Footer Status - Controlled by Config */}
                {config.footer.enabled && (
                    <div className="mt-4 text-[10px] text-gray-500 flex items-center gap-3 fixed bottom-2 bg-[#181a3e]/90 px-4 py-1.5 rounded-full backdrop-blur-sm border border-gray-700 shadow-lg z-40">
                        
                        {config.footer.showCycleTotal && (
                            <div className="flex items-center gap-1">
                                <RefreshCw className="w-3 h-3" />
                                <span>{config.cycleDuration}s</span>
                            </div>
                        )}

                        {config.footer.showTimeLeft && (
                            <div className={`flex items-center gap-1 ${isInteracting ? 'text-yellow-500' : (timeLeft <= 3 ? 'text-yellow-400' : 'text-gray-400')}`}>
                                <Hourglass className="w-3 h-3" />
                                <span>Next in: {timeLeft}s</span>
                            </div>
                        )}

                        {config.footer.showLastUpdate && lastUpdated && (
                            <div className="hidden sm:flex items-center gap-1 border-l border-gray-600 pl-3">
                                <span>Updated: {lastUpdated.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                        )}

                        {config.footer.showClock && (
                            <div className="flex items-center gap-1 border-l border-gray-600 pl-3 text-cyan-400 font-mono font-bold">
                                <Clock className="w-3 h-3" />
                                {currentTime.toLocaleTimeString()}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Leaderboard;