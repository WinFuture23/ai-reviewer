(function() {
    // Verhindert doppeltes Laden, falls das Skript mehrfach eingebunden wird
    if (window._aiReviewerInitialized) return;
    window._aiReviewerInitialized = true;

    let terminalContainer = null;
    let launcherTab = null;
    let pollIntervalActive = false;
    let cachedDiff = { left: null, right: null, html: null };
    let debugLog = [];

    const diffAccounts = [
        'Sk@WinFuture.de',
        'Sebastian.Kuhbach@WinFuture.de',
        'mesios@WinFuture.de',
        'Coding@WinFuture.de',
        'Diiff@WinFuture.de'
    ];

    function logDebug(msg) {
        const time = new Date().toLocaleTimeString('de-DE');
        debugLog.push(`[${time}] ${msg}`);
        console.log(`🤖 AI-Reviewer: ${msg}`);
    }

    function formatDurationFriendly(totalSeconds) {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        const minStr = m === 1 ? 'Minute' : 'Minuten';
        const sekStr = s === 1 ? 'Sekunde' : 'Sekunden';
        if (m > 0 && s > 0) return `${m} ${minStr} ${s} ${sekStr}`;
        if (m > 0) return `${m} ${minStr}`;
        return `${s} ${sekStr}`;
    }

    function cleanAIContent(text) {
        if (!text) return text;
        let t = text.trim();
        if (t.startsWith('{') && t.endsWith('}')) {
            try {
                let parsed = JSON.parse(t);
                if (parsed.Content) return parsed.Content;
                if (parsed.content) return parsed.content;
            } catch(e) {
                logDebug('Hinweis: Text sah wie JSON aus, war aber nicht valide.');
            }
        }
        return t; 
    }

    function lockEditor() {
        if (window.news_text_editor && typeof window.news_text_editor.setReadOnly === 'function') {
            window.news_text_editor.setReadOnly(true);
            const aceContainer = window.news_text_editor.container; 
            if (aceContainer) {
                aceContainer.style.transition = 'opacity 0.3s ease';
                aceContainer.style.opacity = '0.5'; 
                let overlay = document.getElementById('ai-ace-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'ai-ace-overlay';
                    Object.assign(overlay.style, {
                        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                        zIndex: '9999', cursor: 'not-allowed', backgroundColor: 'rgba(255, 255, 255, 0.1)'
                    });
                    aceContainer.appendChild(overlay);
                }
            }
        } else {
            const fallbackEl = document.getElementById('news_text');
            if (fallbackEl) {
                fallbackEl.disabled = true;
                fallbackEl.style.transition = 'opacity 0.3s ease';
                fallbackEl.style.opacity = '0.5';
                fallbackEl.style.cursor = 'not-allowed';
            }
        }
        logDebug('Editor gesperrt (Overlay aktiv).');
    }

    function unlockEditor() {
        if (window.news_text_editor && typeof window.news_text_editor.setReadOnly === 'function') {
            window.news_text_editor.setReadOnly(false);
            const aceContainer = window.news_text_editor.container;
            if (aceContainer) {
                aceContainer.style.opacity = '1';
                let overlay = document.getElementById('ai-ace-overlay');
                if (overlay) overlay.remove();
            }
        } else {
            const fallbackEl = document.getElementById('news_text');
            if (fallbackEl) {
                fallbackEl.disabled = false;
                fallbackEl.style.opacity = '1';
                fallbackEl.style.cursor = 'auto';
            }
        }
        logDebug('Editor freigegeben.');
    }

    // --- DIFFCHECKER API OVERLAY ---
    function showDiffOverlay(htmlData) {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: '9999999', display: 'flex', flexDirection: 'column', padding: '20px', boxSizing: 'border-box' });
        const headerBar = document.createElement('div'); Object.assign(headerBar.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', color: '#fff', fontFamily: 'sans-serif' });
        headerBar.innerHTML = '<h2 style="margin:0;">🔍 Diff-Ansicht: Vorher vs. Nachher</h2>';
        const closeDiffBtn = document.createElement('button'); closeDiffBtn.innerHTML = '✖ Ansicht schließen';
        Object.assign(closeDiffBtn.style, { backgroundColor: '#ff5555', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' });
        closeDiffBtn.onclick = () => overlay.remove(); headerBar.appendChild(closeDiffBtn);
        const iframe = document.createElement('iframe'); Object.assign(iframe.style, { flexGrow: '1', width: '100%', backgroundColor: '#fff', border: 'none', borderRadius: '6px' });
        iframe.srcdoc = htmlData; 
        overlay.appendChild(headerBar); overlay.appendChild(iframe); document.body.appendChild(overlay);
    }

    // --- INITIALISIERUNG DES WIDGETS (LIPPE) ---
    function initWidget() {
        launcherTab = document.createElement('div');
        launcherTab.id = 'ai-reviewer-launcher';
        Object.assign(launcherTab.style, {
            position: 'fixed', bottom: '0', right: '40px', backgroundColor: '#007acc', color: '#fff',
            padding: '10px 20px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
            cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold',
            fontSize: '14px', zIndex: '999999', boxShadow: '0 -2px 10px rgba(0,0,0,0.3)',
            transition: 'background-color 0.2s', display: 'flex', alignItems: 'center', gap: '8px'
        });
        launcherTab.innerHTML = '<span>🤖 KI-Korrektor</span>';

        launcherTab.onmouseover = () => launcherTab.style.backgroundColor = '#005f9e';
        launcherTab.onmouseout = () => launcherTab.style.backgroundColor = '#007acc';

        launcherTab.onclick = () => {
            launcherTab.style.display = 'none';
            if (!terminalContainer) {
                buildTerminal(); // Lazy Loading: Erstellt das Terminal beim ersten Klick
            } else {
                terminalContainer.style.display = 'flex'; // Zeigt das versteckte Terminal wieder
            }
        };

        document.body.appendChild(launcherTab);
    }

    // --- AUFBAU DES HAUPT-TERMINALS ---
    function buildTerminal() {
        terminalContainer = document.createElement('div');
        terminalContainer.id = 'ai-reviewer-terminal';
        Object.assign(terminalContainer.style, {
            position: 'fixed', bottom: '20px', right: '20px', width: '650px', height: '600px',
            minWidth: '400px', minHeight: '350px', backgroundColor: '#1e1e1e', color: '#f8f8f2', 
            fontFamily: 'Consolas, "Courier New", monospace', border: '1px solid #444', 
            borderRadius: '6px', zIndex: '999999', display: 'flex', flexDirection: 'column', 
            boxShadow: '0 10px 40px rgba(0,0,0,0.9)', fontSize: '13px', overflow: 'hidden' 
        });

        // Resize Handles
        const topHandle = document.createElement('div'); Object.assign(topHandle.style, { position: 'absolute', top: '-2px', left: '0', right: '0', height: '6px', cursor: 'ns-resize', zIndex: '10' });
        const leftHandle = document.createElement('div'); Object.assign(leftHandle.style, { position: 'absolute', top: '0', left: '-2px', bottom: '0', width: '6px', cursor: 'ew-resize', zIndex: '10' });
        const cornerHandle = document.createElement('div'); Object.assign(cornerHandle.style, { position: 'absolute', top: '-4px', left: '-4px', width: '12px', height: '12px', cursor: 'nwse-resize', zIndex: '11' });

        let isResizing = false; let resizeType = '';
        function initResize(e, type) { e.preventDefault(); isResizing = true; resizeType = type; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', stopResize); document.body.style.userSelect = 'none'; }
        function handleMouseMove(e) { if (!isResizing) return; if (resizeType === 'left' || resizeType === 'both') { const newWidth = window.innerWidth - e.clientX - 20; if (newWidth > 400) terminalContainer.style.width = newWidth + 'px'; } if (resizeType === 'top' || resizeType === 'both') { const newHeight = window.innerHeight - e.clientY - 20; if (newHeight > 300) terminalContainer.style.height = newHeight + 'px'; } }
        function stopResize() { isResizing = false; document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', stopResize); document.body.style.userSelect = ''; }

        topHandle.addEventListener('mousedown', (e) => initResize(e, 'top')); leftHandle.addEventListener('mousedown', (e) => initResize(e, 'left')); cornerHandle.addEventListener('mousedown', (e) => initResize(e, 'both'));
        terminalContainer.appendChild(topHandle); terminalContainer.appendChild(leftHandle); terminalContainer.appendChild(cornerHandle);

        // Header
        const header = document.createElement('div');
        Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 15px', backgroundColor: '#333333', borderBottom: '1px solid #222', color: '#ccc', fontSize: '12px', userSelect: 'none' });
        header.innerHTML = '<span>🤖 KI-Korrektor & Verlinker</span>';
        
        const headerActions = document.createElement('div'); headerActions.style.display = 'flex'; headerActions.style.gap = '15px';
        const debugBtn = document.createElement('span'); debugBtn.innerHTML = '📋 Debug kopieren';
        Object.assign(debugBtn.style, { cursor: 'pointer', color: '#8be9fd', transition: 'color 0.2s' });
        debugBtn.onclick = () => { navigator.clipboard.writeText(debugLog.join('\n')).then(() => { const oldText = debugBtn.innerHTML; debugBtn.innerHTML = '✅ Kopiert!'; setTimeout(() => debugBtn.innerHTML = oldText, 2000); }); };

        // MINIMIEREN STATT LÖSCHEN
        const closeHeaderBtn = document.createElement('span'); closeHeaderBtn.innerHTML = '▼ Verbergen';
        Object.assign(closeHeaderBtn.style, { cursor: 'pointer', fontWeight: 'bold', color: '#ffb86c', transition: 'color 0.2s' });
        closeHeaderBtn.onmouseover = () => closeHeaderBtn.style.color = '#ff9900'; closeHeaderBtn.onmouseout = () => closeHeaderBtn.style.color = '#ffb86c';
        closeHeaderBtn.onclick = () => { terminalContainer.style.display = 'none'; launcherTab.style.display = 'flex'; };
        
        headerActions.appendChild(debugBtn); headerActions.appendChild(closeHeaderBtn); header.appendChild(headerActions);

        // Content Area
        const contentArea = document.createElement('div');
        Object.assign(contentArea.style, { flexGrow: '1', overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px', wordWrap: 'break-word', backgroundColor: '#1e1e1e' });
        const statusEl = document.createElement('div'); statusEl.style.fontWeight = 'bold'; contentArea.appendChild(statusEl);
        const resultsArea = document.createElement('div'); Object.assign(resultsArea.style, { display: 'flex', flexDirection: 'column', gap: '12px' }); 
        contentArea.appendChild(resultsArea);

        // Footer & Buttons
        const footer = document.createElement('div');
        Object.assign(footer.style, { padding: '15px', backgroundColor: '#252526', display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'stretch', borderTop: '1px solid #333', width: '100%', boxSizing: 'border-box' });

        const btnCheck = document.createElement('button'); btnCheck.innerHTML = '🚀 Artikel überprüfen';
        Object.assign(btnCheck.style, { backgroundColor: '#007acc', color: '#ffffff', border: '1px solid #005f9e', padding: '10px 24px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.2s ease', outline: 'none', display: 'block' });
        btnCheck.onmouseover = () => btnCheck.style.backgroundColor = '#005f9e'; btnCheck.onmouseout = () => btnCheck.style.backgroundColor = '#007acc';

        const actionBtnStyle = { padding: '10px 5px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '13px', outline: 'none', border: 'none', display: 'none', justifyContent: 'center', alignItems: 'center', gap: '6px', transition: 'all 0.2s ease', flex: '1', whiteSpace: 'nowrap' };

        const btnDiff = document.createElement('button'); btnDiff.innerHTML = '🔍 Unterschiede anzeigen';
        Object.assign(btnDiff.style, actionBtnStyle, { backgroundColor: '#f1fa8c', color: '#282a36' });
        btnDiff.onmouseover = () => btnDiff.style.backgroundColor = '#e2eb70'; btnDiff.onmouseout = () => btnDiff.style.backgroundColor = '#f1fa8c';

        const btnUndo = document.createElement('button'); btnUndo.innerHTML = '↺ Rückgängig machen';
        Object.assign(btnUndo.style, actionBtnStyle, { backgroundColor: '#d9534f', color: '#ffffff' });
        btnUndo.onmouseover = () => btnUndo.style.backgroundColor = '#c9302c'; btnUndo.onmouseout = () => btnUndo.style.backgroundColor = '#d9534f';

        const btnCloseBottom = document.createElement('button'); btnCloseBottom.innerHTML = '▼ Verbergen';
        Object.assign(btnCloseBottom.style, actionBtnStyle, { backgroundColor: '#44475a', color: '#f8f8f2' });
        btnCloseBottom.onmouseover = () => btnCloseBottom.style.backgroundColor = '#6272a4'; btnCloseBottom.onmouseout = () => btnCloseBottom.style.backgroundColor = '#44475a';
        btnCloseBottom.onclick = () => { terminalContainer.style.display = 'none'; launcherTab.style.display = 'flex'; };

        footer.appendChild(btnCheck); footer.appendChild(btnDiff); footer.appendChild(btnUndo); footer.appendChild(btnCloseBottom);
        terminalContainer.appendChild(header); terminalContainer.appendChild(contentArea); terminalContainer.appendChild(footer); 
        document.body.appendChild(terminalContainer);

        function setStatusIconText(icon, mainText, subText = null, color = '#f8f8f2', writeToDebug = true) {
            statusEl.innerHTML = `<div style="display: flex; align-items: flex-start; gap: 8px; color: ${color};"><span style="line-height: 1.4; font-size: 14px; width: 20px; text-align: center;">${icon}</span><div style="display: flex; flex-direction: column;"><span style="line-height: 1.4;">${mainText}</span>${subText ? `<span style="font-size: 11px; color: #aaaaaa; font-weight: normal; margin-top: 2px;">${subText}</span>` : ''}</div></div>`;
            if (writeToDebug) logDebug(`Status: ${mainText}`);
        }

        function addMessage(msg, type = 'info') {
            const entry = document.createElement('div'); entry.innerHTML = msg;
            if (type === 'error') entry.style.color = '#ff5555'; if (type === 'warning') entry.style.color = '#ffb86c'; if (type === 'success') entry.style.color = '#50fa7b';
            resultsArea.appendChild(entry); contentArea.scrollTop = contentArea.scrollHeight;
        }

        setStatusIconText('🟢', 'Bereit.', null, '#50fa7b');

        // --- DiffChecker Button Logic ---
        btnDiff.onclick = async () => {
            const oldBtnText = btnDiff.innerHTML; btnDiff.innerHTML = '⏳ Lade...'; btnDiff.disabled = true;
            try {
                let currentEditorText = window.news_text_editor ? window.news_text_editor.getValue() : (document.getElementById('news_text') ? document.getElementById('news_text').value : '');
                const originalText = window._aiReviewerBackup || '';
                
                if (cachedDiff.html && cachedDiff.left === originalText && cachedDiff.right === currentEditorText) { 
                    showDiffOverlay(cachedDiff.html); return; 
                }
                
                const randomEmail = diffAccounts[Math.floor(Math.random() * diffAccounts.length)];
                logDebug(`Rufe Diffchecker API auf (Account: ${randomEmail})...`);
                
                const res = await fetch(`https://api.diffchecker.com/public/text?output_type=html&email=${encodeURIComponent(randomEmail)}`, { 
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ left: originalText, right: currentEditorText, diff_level: 'word' }) 
                });
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const htmlData = await res.text();
                
                cachedDiff = { left: originalText, right: currentEditorText, html: htmlData }; 
                showDiffOverlay(htmlData);
            } catch (err) { 
                addMessage(`<b>Hinweis:</b> Konnte DiffChecker API nicht laden (${err.message}).`, 'warning'); 
            } finally { 
                btnDiff.innerHTML = oldBtnText; btnDiff.disabled = false; 
            }
        };

        btnUndo.onclick = () => {
            if (window.news_text_editor && typeof window.news_text_editor.setValue === 'function') window.news_text_editor.setValue(window._aiReviewerBackup, -1);
            else if (document.getElementById('news_text')) document.getElementById('news_text').value = window._aiReviewerBackup;
            addMessage('<b>Hinweis:</b> Originaltext wurde wiederhergestellt.', 'warning'); logDebug('Originaltext wiederhergestellt.');
        };

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // --- HAUPT-POLLING LOGIK ---
        btnCheck.addEventListener('click', async () => {
            btnCheck.disabled = true; btnCheck.style.display = 'none'; resultsArea.innerHTML = ''; debugLog = []; cachedDiff = { left: null, right: null, html: null }; 

            logDebug('Starte Überprüfungsprozess...');
            let timerInterval;
            pollIntervalActive = true;
            launcherTab.querySelector('span').innerText = '⏳ KI arbeitet...';

            try {
                setStatusIconText('⏳', 'Lese Editor-Inhalt aus...', null, '#8be9fd');
                let content = window.news_text_editor ? window.news_text_editor.getValue() : (document.getElementById('news_text') ? document.getElementById('news_text').value : '');
                if (!content || !content.trim()) throw new Error('Der Editor ist leer. Abbruch.');
                window._aiReviewerBackup = content;

                lockEditor();

                const jobId = 'wf_job_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                const WORKER_WEBHOOK_URL = 'https://hook.eu1.make.com/4a99tk0ia1k9dt7zwmx4snc6k6ojw4d0'; 
                const POLLER_WEBHOOK_URL = 'https://hook.eu1.make.com/5avvbjue78b5tkjcen388mnz9ib32kr4'; 
                
                logDebug(`Mache POST Request an Worker. JobID: ${jobId}`);
                const startRes = await fetch(WORKER_WEBHOOK_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: content, jobId: jobId })
                });

                if (!startRes.ok) throw new Error(`Der Worker konnte nicht gestartet werden (HTTP ${startRes.status}).`);

                let elapsedSeconds = 0; 
                const timeoutMax = 1800; // 30 Minuten
                
                setStatusIconText('⏳', `Artikel wird verarbeitet... (0 Sekunden)`, `Geschätzte Dauer: ca. 3 - 4 Minuten`, '#f1fa8c', true);
                const startTime = Date.now();
                
                timerInterval = setInterval(() => {
                    if (!pollIntervalActive) return;
                    elapsedSeconds++;
                    const timeStr = formatDurationFriendly(elapsedSeconds);
                    setStatusIconText('⏳', `Artikel wird verarbeitet... (${timeStr})`, `Geschätzte Dauer: ca. 3 - 4 Minuten`, '#f1fa8c', false);
                    
                    if (elapsedSeconds >= timeoutMax) {
                        pollIntervalActive = false; clearInterval(timerInterval); unlockEditor();
                        launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                        setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                        addMessage(`Das Polling wurde nach ${formatDurationFriendly(timeoutMax)} abgebrochen.`, 'error');
                        btnCheck.style.display = 'block'; btnCheck.disabled = false;
                    }
                }, 1000);
                
                (async function pollLoop() {
                    try {
                        while (pollIntervalActive) {
                            let currentElapsed = Math.round((Date.now() - startTime) / 1000);
                            if (currentElapsed >= timeoutMax) break;

                            let nextTarget;
                            if (currentElapsed < 120) { nextTarget = 120; } 
                            else if (currentElapsed < 150) { nextTarget = currentElapsed + 30; } 
                            else if (currentElapsed < 240) { nextTarget = currentElapsed + 10; } 
                            else { nextTarget = currentElapsed + 60; }

                            let sleepSecs = nextTarget - currentElapsed;
                            if (sleepSecs > 0) {
                                for(let i=0; i < sleepSecs; i++) {
                                    if (!pollIntervalActive) return; 
                                    await sleep(1000);
                                }
                            }

                            if (!pollIntervalActive) break;

                            logDebug(`Frage Status ab...`);
                            const pollRes = await fetch(`${POLLER_WEBHOOK_URL}?jobId=${jobId}`);
                            if (!pollRes.ok) continue; 
                            
                            const rawText = await pollRes.text();
                            const statusMatch = rawText.match(/<status>([\s\S]*?)<\/status>/i);
                            const jobStatus = statusMatch ? statusMatch[1].trim() : 'pending';

                            if (jobStatus === 'pending') continue; 

                            pollIntervalActive = false; clearInterval(timerInterval); unlockEditor(); 
                            const finalDurationStr = formatDurationFriendly(Math.round((Date.now() - startTime) / 1000));
                            logDebug(`Job abgeschlossen: ${jobStatus}.`);

                            if (jobStatus === 'error') {
                                const errorMatch = rawText.match(/<fixes>([\s\S]*?)<\/fixes>/i) || rawText.match(/<error>([\s\S]*?)<\/error>/i);
                                const errMsg = errorMatch ? errorMatch[1].trim() : 'Unbekannter Fehler im KI-Agenten.';
                                
                                launcherTab.querySelector('span').innerText = '❌ KI-Fehler';
                                setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                                addMessage(`<b>Fehlerdetails:</b> ${errMsg}`, 'error');
                                btnCheck.style.display = 'block'; btnCheck.disabled = false;
                                return; 
                            }

                            if (jobStatus === 'success') {
                                launcherTab.querySelector('span').innerText = '✅ KI Fertig';
                                const contentMatch = rawText.match(/<content>([\s\S]*?)<\/content>/i);
                                let newContent = contentMatch ? contentMatch[1].trim() : null;
                                const fixesMatch = rawText.match(/<fixes>([\s\S]*?)<\/fixes>/i);
                                const fixesText = fixesMatch ? fixesMatch[1] : '';
                                
                                const korrektorMatch = fixesText.match(/<korrektor>([\s\S]*?)<\/korrektor>/i);
                                const verlinkerMatch = fixesText.match(/<verlinker>([\s\S]*?)<\/verlinker>/i);
                                let korrektorText = korrektorMatch ? korrektorMatch[1].trim() : null;
                                const verlinkerText = verlinkerMatch ? verlinkerMatch[1].trim() : null;

                                if (korrektorText) korrektorText = korrektorText.replace(/\. (Rechtschreibung|Grammatik|Die Rechtschreibung|Zur Rechtschreibung|Es wurden keine signifikanten)/gi, '.\n$1').replace(/\. (Die Shortcode|Shortcodes)/gi, '.\n$1');
                                if (!newContent) throw new Error('Erfolg gemeldet, aber kein Text gespeichert.');

                                newContent = cleanAIContent(newContent);
                                setStatusIconText('⏳', 'Schreibe Text in Editor...', null, '#8be9fd');
                                window._aiReviewerNewText = newContent; 
                                
                                if (window.news_text_editor && typeof window.news_text_editor.setValue === 'function') {
                                    window.news_text_editor.setValue(newContent, -1); window.wfv4_news_changed = true;
                                } else {
                                    const fallbackEl = document.getElementById('news_text');
                                    if (fallbackEl) { fallbackEl.value = newContent; window.wfv4_news_changed = true; } 
                                    else throw new Error('Editor zum Zurückschreiben wurde nicht gefunden.');
                                }

                                setStatusIconText('✅', `Erfolgreich aktualisiert! (Dauer: ${finalDurationStr})`, null, '#50fa7b');
                                btnDiff.style.display = 'flex'; btnUndo.style.display = 'flex'; btnCloseBottom.style.display = 'flex';

                                if (korrektorText) {
                                    const korrBox = document.createElement('div'); Object.assign(korrBox.style, { backgroundColor: '#2d2d30', padding: '12px', borderRadius: '6px', border: '1px solid #3a3a3c' });
                                    const kTitle = document.createElement('div'); kTitle.innerHTML = '<span style="color:#8be9fd; font-weight:bold; font-size:14px;">📝 Text- & Shortcode-Korrekturen</span><hr style="border:0; border-top:1px solid #444; margin:8px 0;">';
                                    korrBox.appendChild(kTitle);
                                    const lines = korrektorText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                                    lines.forEach(line => {
                                        let cleanLine = line.replace(/^[-*•#\d.]+\s*/, ''); 
                                        const div = document.createElement('div');
                                        if(cleanLine.toLowerCase().includes('keine korrek') || cleanLine.toLowerCase().includes('nicht')) {
                                            div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${cleanLine}</span>`; div.style.marginTop = '6px';
                                        } else {
                                            div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${cleanLine}</span>`; div.style.marginTop = '6px'; div.style.paddingLeft = '5px';
                                        }
                                        korrBox.appendChild(div);
                                    });
                                    resultsArea.appendChild(korrBox);
                                }

                                if (verlinkerText) {
                                    const verlBox = document.createElement('div'); Object.assign(verlBox.style, { backgroundColor: '#2d2d30', padding: '12px', borderRadius: '6px', border: '1px solid #3a3a3c' });
                                    const vTitle = document.createElement('div'); vTitle.innerHTML = '<span style="color:#50fa7b; font-weight:bold; font-size:14px;">🔗 Verlinkungen & Hinweise</span><hr style="border:0; border-top:1px solid #444; margin:8px 0;">';
                                    verlBox.appendChild(vTitle);
                                    const lines = verlinkerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                                    let currentGroup = null;
                                    lines.forEach(line => {
                                        let cleanLine = line.replace(/^[-*•#\d.]+\s*/, '').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #66d9ef; text-decoration: underline;">$1</a>');
                                        const lineLower = cleanLine.toLowerCase();
                                        if (lineLower.startsWith('link')) {
                                            currentGroup = document.createElement('div'); Object.assign(currentGroup.style, { borderLeft: '3px solid #007acc', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                            currentGroup.innerHTML = `<div>► <span style="color:#f8f8f2; font-weight:bold;">${cleanLine}</span></div>`;
                                            verlBox.appendChild(currentGroup);
                                        } else if (lineLower.startsWith('begründung') && currentGroup) {
                                            const reasonDiv = document.createElement('div'); reasonDiv.innerHTML = `<span style="color:#cccccc;">${cleanLine}</span>`; reasonDiv.style.marginTop = '6px';
                                            currentGroup.appendChild(reasonDiv);
                                        } else {
                                            currentGroup = null; 
                                            const div = document.createElement('div'); Object.assign(div.style, { marginTop: '6px', paddingLeft: '5px' });
                                            if(lineLower.includes('keine') || lineLower.includes('nicht') || lineLower.includes('wurden')) {
                                                Object.assign(div.style, { borderLeft: '3px solid #ffb86c', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                                div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${cleanLine}</span>`;
                                            } else {
                                                div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${cleanLine}</span>`;
                                            }
                                            verlBox.appendChild(div);
                                        }
                                    });
                                    resultsArea.appendChild(verlBox);
                                }
                            }
                        }
                    } catch (pollErr) {
                        if (pollIntervalActive) {
                            pollIntervalActive = false; clearInterval(timerInterval); unlockEditor(); 
                            launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                            btnCheck.style.display = 'block'; btnCheck.disabled = false;
                            setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                            addMessage(pollErr.message, 'error');
                        }
                    }
                })();
            } catch (error) {
                pollIntervalActive = false; clearInterval(timerInterval); unlockEditor(); 
                launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                btnCheck.style.display = 'block'; btnCheck.disabled = false;
                setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                addMessage(error.message, 'error');
            }
        });
    }

    // Wenn das DOM bereits geladen ist, direkt starten. Ansonsten auf DOMContentLoaded warten.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        initWidget();
    }

})();