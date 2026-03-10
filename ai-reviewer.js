(function() {
    // Verhindert doppeltes Laden, falls das Skript mehrfach eingebunden wird
    if (window.wfv4_ai_reviewer_loaded) return;
    window.wfv4_ai_reviewer_loaded = true;

    // CSS-Animationen
    if (!document.getElementById('ai-reviewer-styles')) {
        const style = document.createElement('style'); style.id = 'ai-reviewer-styles';
        style.textContent = '@keyframes ai-reviewer-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }

    /**
     * wfv4_link_preview — Reusable link preview tooltip card.
     *
     * Fetches OG metadata (title, description, image) for internal links
     * and displays a hover card with article summary.
     *
     * Usage:
     *   wfv4_link_preview.attach( container, selector, url_extractor )
     *   - container:     parent DOM element containing hoverable elements
     *   - selector:      CSS selector for hoverable elements
     *   - url_extractor: function( element ) => URL string
     *
     * Standalone (e.g. in global JS):
     *   wfv4_link_preview.attach( document.body, 'a[href*="winfuture.de/news"]', a => a.href );
     *
     * @author mesios
     * @version 1 2026-03-10
     */
    const wfv4_link_preview = (() => {
        const cache = new Map();
        let card = null;
        let hide_timer = null;
        let show_timer = null;

        // Fetch page head, extract OG metadata
        async function fetch_meta( url ) {
            if (cache.has( url )) return;
            cache.set( url, null );
            try {
                const resp = await fetch( url, { credentials: 'same-origin' } );
                if (!resp.ok) return;
                // response.text() respects Content-Type charset (fixes Umlauts)
                const html = await resp.text();
                const head_end = html.indexOf( '</head>' );
                const head_html = html.substring( 0, head_end > 0 ? head_end + 7 : 20000 );
                const doc = new DOMParser().parseFromString( head_html, 'text/html' );
                const og = ( p ) => {
                    const el = doc.querySelector( `meta[property="og:${p}"]` );
                    return el ? el.getAttribute( 'content' ) : null;
                };
                const meta = ( n ) => {
                    const el = doc.querySelector( `meta[name="${n}"]` );
                    return el ? el.getAttribute( 'content' ) : null;
                };
                const title = og( 'title' ) || doc.querySelector( 'title' )?.textContent?.trim() || null;
                const description = og( 'description' ) || meta( 'description' ) || null;
                const image = og( 'image' ) || null;
                if (title) {
                    cache.set( url, { title, description, image, url } );
                }
            } catch( e ) { /* silent — no card shown on error */ }
        }

        // HTML-escape a string (XSS prevention, Sicherheitsrichtlinie §14/§24)
        function esc( str ) {
            if (!str) return '';
            const d = document.createElement( 'div' );
            d.appendChild( document.createTextNode( str ) );
            return d.innerHTML;
        }

        // Create singleton card element (lazy)
        function ensure_card() {
            if (card) return card;
            card = document.createElement( 'div' );
            card.className = 'wfv4-link-preview';
            Object.assign( card.style, {
                position: 'fixed', zIndex: '1000000', width: '420px', maxWidth: 'calc(100vw - 24px)',
                backgroundColor: '#1e1e1e', border: '1px solid #555', borderRadius: '10px',
                boxShadow: '0 8px 28px rgba(0,0,0,0.55)', overflow: 'hidden',
                opacity: '0', transform: 'translateY(6px)',
                transition: 'opacity 0.18s ease, transform 0.18s ease, border-color 0.15s ease',
                pointerEvents: 'auto', fontFamily: 'system-ui, -apple-system, sans-serif',
                cursor: 'pointer', display: 'none'
            });
            card.addEventListener( 'mouseenter', () => { clearTimeout( hide_timer ); card.style.borderColor = '#66d9ef'; } );
            card.addEventListener( 'mouseleave', () => { card.style.borderColor = '#555'; hide(); } );
            card.addEventListener( 'click', () => {
                if (card._url) { window.open( card._url, '_blank', 'noopener' ); hide(); }
            });
            document.body.appendChild( card );
            return card;
        }

        // Show preview card at given position
        function show( url, x, y ) {
            const data = cache.get( url );
            if (!data) return;
            const c = ensure_card();
            c._url = url;
            const img_html = data.image
                ? `<img src="${esc( data.image )}" style="width:120px; min-width:120px; height:auto; min-height:80px; max-height:120px; object-fit:cover; border-radius:6px; background:#2a2a2c;" onerror="this.style.display='none'">`
                : '';
            const desc_html = data.description
                ? `<div style="font-size:12px; color:#bbb; line-height:1.4; margin-top:5px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${esc( data.description )}</div>`
                : '';
            c.innerHTML = `<div style="display:flex; gap:12px; padding:12px 14px; align-items:flex-start;">`
                + img_html
                + `<div style="flex:1; min-width:0;">`
                + `<div style="font-size:14px; font-weight:600; color:#f0f0f0; line-height:1.35; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${esc( data.title )}</div>`
                + desc_html
                + `<div style="font-size:10px; color:#666; margin-top:5px;">↗ Artikel öffnen</div>`
                + `</div></div>`;

            c.style.opacity = '0';
            c.style.display = 'block';
            requestAnimationFrame( () => {
                const cw = c.offsetWidth, ch = c.offsetHeight;
                const vw = window.innerWidth, vh = window.innerHeight;
                let left = x + 14, top = y + 14;
                if (left + cw > vw - 12) left = x - cw - 14;
                if (top + ch > vh - 12) top = y - ch - 14;
                if (left < 8) left = 8;
                if (top < 8) top = 8;
                c.style.left = left + 'px';
                c.style.top = top + 'px';
                c.style.opacity = '1';
                c.style.transform = 'translateY(0)';
            });
        }

        // Hide preview card with fade-out
        function hide() {
            clearTimeout( show_timer );
            if (!card) return;
            card.style.opacity = '0';
            card.style.transform = 'translateY(6px)';
            hide_timer = setTimeout( () => { if (card) card.style.display = 'none'; }, 200 );
        }

        // Attach preview to all matching elements in container
        function attach( container, selector, url_extractor ) {
            const elements = container.querySelectorAll( selector );
            const urls = new Set();
            elements.forEach( el => { const u = url_extractor( el ); if (u) urls.add( u ); } );

            // Prefetch all (max 4 parallel)
            (async () => {
                const arr = [...urls];
                for (let i = 0; i < arr.length; i += 4) {
                    await Promise.all( arr.slice( i, i + 4 ).map( u => fetch_meta( u ) ) );
                }
            })();

            // Hover events on each element
            elements.forEach( el => {
                const url = url_extractor( el );
                if (!url) return;
                el.addEventListener( 'mouseenter', ( e ) => {
                    clearTimeout( hide_timer );
                    clearTimeout( show_timer );
                    el._mx = e.clientX;
                    el._my = e.clientY;
                    show_timer = setTimeout( () => show( url, el._mx, el._my ), 250 );
                });
                el.addEventListener( 'mousemove', ( e ) => { el._mx = e.clientX; el._my = e.clientY; } );
                el.addEventListener( 'mouseleave', () => {
                    clearTimeout( show_timer );
                    hide_timer = setTimeout( () => hide(), 200 );
                });
            });
        }

        // Remove card from DOM and clear timers
        function destroy() {
            if (card) { card.remove(); card = null; }
            clearTimeout( hide_timer );
            clearTimeout( show_timer );
        }

        return { attach, destroy, cache };
    })();

    let terminalContainer = null;
    let launcherTab = null;
    let pollIntervalActive = false;
    let cachedDiff = { left: null, right: null, html: null };
    let debugLog = [];
    let backup_content = null;
    let btnCheck = null;

    const _da = ['U2s=','U2ViYXN0aWFuLkt1aGJhY2g=','bWVzaW9z','Q29kaW5n','RGlpZmY='];
    const _dd = 'QFdpbkZ1dHVyZS5kZQ==';
    const diffAccounts = _da.map(a => atob(a) + atob(_dd));

    const PROXY_URL = 'https://mesios--43bb6c1c197111f18d1642dde27851f2.web.val.run';
    const POLLER_URL = 'https://mesios--f12a09281c8f11f1845142dde27851f2.web.val.run';
    const POLLER_API_KEY = 'wf_super_secret_key_2026_xyz';

    function logDebug(msg) {
        const time = new Date().toLocaleTimeString('de-DE');
        debugLog.push(`[${time}] ${msg}`);
        console.log(`🤖 AI-Reviewer [${time}]: ${msg}`);
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

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
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
                let overlay = document.getElementById('ai-reviewer-ace-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'ai-reviewer-ace-overlay';
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
                let overlay = document.getElementById('ai-reviewer-ace-overlay');
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
        function closeDiff() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', escHandler); }
        closeDiffBtn.onclick = closeDiff; headerBar.appendChild(closeDiffBtn);
        const iframe = document.createElement('iframe');
        iframe.sandbox = 'allow-same-origin'; // Sicherheitsrichtlinie §20: minimal permissions
        Object.assign(iframe.style, { flexGrow: '1', width: '100%', backgroundColor: '#fff', border: 'none', borderRadius: '6px' });
        iframe.srcdoc = htmlData;
        overlay.appendChild(headerBar); overlay.appendChild(iframe); document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        const escHandler = (e) => { if (e.key === 'Escape') closeDiff(); };
        document.addEventListener('keydown', escHandler);
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
            // Artikel-Prüfung direkt auslösen (Button ist initial hidden, nur bei Fehler sichtbar)
            requestAnimationFrame(() => setTimeout(() => { if (btnCheck && !btnCheck.disabled) btnCheck.click(); }, 100));
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
        
        const headerRight = document.createElement('div'); Object.assign(headerRight.style, { display: 'flex', gap: '15px', alignItems: 'center' });

        const debugBtn = document.createElement('span'); debugBtn.innerHTML = 'Debug';
        Object.assign(debugBtn.style, { cursor: 'pointer', color: '#6272a4', fontSize: '11px', transition: 'color 0.2s' });
        debugBtn.onmouseover = () => debugBtn.style.color = '#8be9fd'; debugBtn.onmouseout = () => debugBtn.style.color = '#6272a4';
        debugBtn.onclick = () => {
            const meta = `URL: ${location.href}\nJobID: ${debugLog.find(l => l.includes('JobID:'))?.match(/JobID:\s*(\S+)/)?.[1] || 'n/a'}\n\n`;
            navigator.clipboard.writeText(meta + debugLog.join('\n')).then(() => {
                const old = debugBtn.innerHTML; debugBtn.innerHTML = 'Kopiert!'; setTimeout(() => debugBtn.innerHTML = old, 2000);
            });
        };

        // MINIMIEREN STATT LÖSCHEN
        const closeHeaderBtn = document.createElement('span'); closeHeaderBtn.innerHTML = '▼ Verbergen';
        Object.assign(closeHeaderBtn.style, { cursor: 'pointer', fontWeight: 'bold', color: '#ffb86c', transition: 'color 0.2s' });
        closeHeaderBtn.onmouseover = () => closeHeaderBtn.style.color = '#ff9900'; closeHeaderBtn.onmouseout = () => closeHeaderBtn.style.color = '#ffb86c';
        closeHeaderBtn.onclick = () => { terminalContainer.style.display = 'none'; launcherTab.style.display = 'flex'; wfv4_link_preview.destroy(); };

        headerRight.appendChild(debugBtn); headerRight.appendChild(closeHeaderBtn);
        header.appendChild(headerRight);

        // Content Area
        const contentArea = document.createElement('div');
        Object.assign(contentArea.style, { flexGrow: '1', overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px', wordWrap: 'break-word', backgroundColor: '#1e1e1e' });
        const statusEl = document.createElement('div'); statusEl.style.fontWeight = 'bold'; contentArea.appendChild(statusEl);
        const resultsArea = document.createElement('div'); Object.assign(resultsArea.style, { display: 'flex', flexDirection: 'column', gap: '12px' }); 
        contentArea.appendChild(resultsArea);

        // Footer & Buttons
        const footer = document.createElement('div');
        Object.assign(footer.style, { padding: '15px', backgroundColor: '#252526', display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'stretch', borderTop: '1px solid #333', width: '100%', boxSizing: 'border-box' });

        btnCheck = document.createElement('button'); btnCheck.innerHTML = '🚀 Artikel überprüfen';
        Object.assign(btnCheck.style, { backgroundColor: '#007acc', color: '#ffffff', border: '1px solid #005f9e', padding: '10px 24px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.2s ease', outline: 'none', display: 'none' });
        btnCheck.onmouseover = () => btnCheck.style.backgroundColor = '#005f9e'; btnCheck.onmouseout = () => btnCheck.style.backgroundColor = '#007acc';

        const actionBtnStyle = { padding: '10px 5px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '13px', outline: 'none', border: 'none', display: 'none', justifyContent: 'center', alignItems: 'center', gap: '6px', transition: 'all 0.2s ease', flex: '1', whiteSpace: 'nowrap' };

        const btnDiff = document.createElement('button'); btnDiff.innerHTML = '🔍 Unterschiede anzeigen';
        Object.assign(btnDiff.style, actionBtnStyle, { backgroundColor: '#f1fa8c', color: '#282a36' });
        btnDiff.onmouseover = () => btnDiff.style.backgroundColor = '#e2eb70'; btnDiff.onmouseout = () => btnDiff.style.backgroundColor = '#f1fa8c';

        const btnUndo = document.createElement('button'); btnUndo.innerHTML = '↺ Rückgängig machen';
        Object.assign(btnUndo.style, actionBtnStyle, { backgroundColor: '#d9534f', color: '#ffffff' });
        btnUndo.onmouseover = () => btnUndo.style.backgroundColor = '#c9302c'; btnUndo.onmouseout = () => btnUndo.style.backgroundColor = '#d9534f';

        const btnCloseBottom = document.createElement('button'); btnCloseBottom.innerHTML = '💾 Speichern';
        btnCloseBottom.className = 'css_button green';
        Object.assign(btnCloseBottom.style, actionBtnStyle, { backgroundColor: '#008800', color: '#fff', borderColor: '#7dc07d #003300 #003300 #7dc07d' });
        btnCloseBottom.onmouseover = () => btnCloseBottom.style.backgroundColor = '#006600'; btnCloseBottom.onmouseout = () => btnCloseBottom.style.backgroundColor = '#008800';
        btnCloseBottom.onclick = () => { wfv4_news_submit(); terminalContainer.style.display = 'none'; };

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
                const originalText = backup_content || '';
                
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
                addMessage(`<b>Hinweis:</b> Konnte DiffChecker API nicht laden (${escapeHTML(err.message)}).`, 'warning');
            } finally { 
                btnDiff.innerHTML = oldBtnText; btnDiff.disabled = false; 
            }
        };

        btnUndo.onclick = () => {
            if (window.news_text_editor && typeof window.news_text_editor.setValue === 'function') window.news_text_editor.setValue(backup_content, -1);
            else if (document.getElementById('news_text')) document.getElementById('news_text').value = backup_content;
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
                backup_content = content;

                lockEditor();

                const jobId = 'wf_job_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                const reviewerAuth = window.wfv4_ai_reviewer_auth || {};
                const authHeaders = reviewerAuth.token ? { 'X-Auth-Token': reviewerAuth.token, 'X-Auth-Ts': String(reviewerAuth.ts) } : {};
                if (!reviewerAuth.token) logDebug('Warnung: Kein Auth-Token gefunden (window.wfv4_ai_reviewer_auth fehlt).');

                logDebug(`Sende Artikel an Proxy. JobID: ${jobId}`);
                const startRes = await fetch(PROXY_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
                    body: JSON.stringify({ action: 'start', text: content, jobId: jobId })
                });

                if (!startRes.ok) throw new Error(`Der Worker konnte nicht gestartet werden (HTTP ${startRes.status}).`);

                let elapsedSeconds = 0; 
                const TIMEOUT_MAX = 600; // 10 Minuten
                
                setStatusIconText('⏳', `Artikel wird verarbeitet... (0 Sekunden)`, `Geschätzte Dauer: ca. 1 - 2 Minuten`, '#f1fa8c', true);
                const startTime = Date.now();
                
                let cachedPollResponse = null;
                let lastPollTime = 0;
                let manualPollBtn = null;

                // Sofort auflösbare Sleep-Funktion (überwindet Browser-Throttling)
                let wakeupResolve = null;
                function wakeup() { if (wakeupResolve) { wakeupResolve(); wakeupResolve = null; } }
                function interruptibleSleep(ms) {
                    return new Promise(resolve => {
                        wakeupResolve = resolve;
                        setTimeout(resolve, ms);
                    });
                }

                // Manuelle Abfrage: Server-Anfrage und Ergebnis an pollLoop übergeben
                async function doManualPoll(label) {
                    logDebug(`${label}: Server-Abfrage...`);
                    lastPollTime = Date.now();
                    try {
                        const pollRes = await fetch(`${POLLER_URL}?jobId=${encodeURIComponent(jobId)}`, {
                            method: 'GET', headers: { 'x-api-key': POLLER_API_KEY }
                        });
                        if (pollRes.ok) {
                            const data = await pollRes.json();
                            const jobStatus = data.status || 'pending';
                            logDebug(`${label}: Status = ${jobStatus}`);
                            if (jobStatus !== 'pending') {
                                cachedPollResponse = data;
                            }
                        }
                    } catch(e) { logDebug(`${label}: Fehlgeschlagen (${e.message})`); }
                    wakeup(); // pollLoop sofort aufwecken
                }

                // visibilitychange: feuert zuverlässig wenn Tab wieder aktiv wird
                function onVisibilityChange() {
                    if (document.visibilityState !== 'visible' || !pollIntervalActive) return;
                    elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
                    if (elapsedSeconds < 30) return;
                    if (Date.now() - lastPollTime < 5000) { logDebug('Tab sichtbar, aber letzter Abruf <5s her. Übersprungen.'); return; }
                    doManualPoll('Tab-Rückkehr');
                }
                document.addEventListener('visibilitychange', onVisibilityChange);

                timerInterval = setInterval(() => {
                    if (!pollIntervalActive) return;
                    elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
                    const timeStr = formatDurationFriendly(elapsedSeconds);
                    setStatusIconText('⏳', `Artikel wird verarbeitet... (${timeStr})`, `Geschätzte Dauer: ca. 1 - 2 Minuten`, '#f1fa8c', false);

                    // Nach 2 Minuten: manuellen Abfrage-Button anzeigen
                    if (!manualPollBtn && elapsedSeconds >= 120) {
                        manualPollBtn = document.createElement('div');
                        manualPollBtn.style.cssText = 'margin-top: 8px; cursor: pointer; color: #8be9fd; font-size: 12px; display: flex; align-items: center; gap: 6px;';
                        const pollIcon = document.createElement('span'); pollIcon.textContent = '🔄'; pollIcon.style.cssText = 'display: inline-block; transition: transform 0.3s;';
                        const pollLabel = document.createElement('span'); pollLabel.textContent = 'Jetzt Status abfragen';
                        const pollStatus = document.createElement('span'); pollStatus.style.cssText = 'color: #aaa; font-size: 11px;';
                        manualPollBtn.appendChild(pollIcon); manualPollBtn.appendChild(pollLabel); manualPollBtn.appendChild(pollStatus);
                        manualPollBtn.addEventListener('click', async () => {
                            pollIcon.style.animation = 'ai-reviewer-spin 1s linear infinite';
                            pollLabel.textContent = 'Frage ab...';
                            pollStatus.textContent = '';
                            await doManualPoll('Manuell');
                            pollIcon.style.animation = '';
                            pollLabel.textContent = 'Jetzt Status abfragen';
                            if (cachedPollResponse) { pollStatus.textContent = '✅ Ergebnis erhalten!'; pollStatus.style.color = '#50fa7b'; }
                            else { pollStatus.textContent = '— wird noch bearbeitet'; pollStatus.style.color = '#aaa'; }
                            setTimeout(() => { pollStatus.textContent = ''; }, 4000);
                        });
                    }
                    if (manualPollBtn) statusEl.appendChild(manualPollBtn);

                    if (elapsedSeconds >= TIMEOUT_MAX) {
                        // Vor Abbruch: letzte Server-Abfrage
                        (async () => {
                            await doManualPoll('Timeout-Abfrage');
                            if (cachedPollResponse) return; // pollLoop verarbeitet
                            // Wirklich kein Ergebnis
                            pollIntervalActive = false; clearInterval(timerInterval); unlockEditor();
                            document.removeEventListener('visibilitychange', onVisibilityChange);
                            launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                            setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                            addMessage(`Das Polling wurde nach ${formatDurationFriendly(TIMEOUT_MAX)} abgebrochen.`, 'error');
                            btnCheck.style.display = 'block'; btnCheck.disabled = false;
                        })();
                    }
                }, 1000);
                
                (async function pollLoop() {
                    try {
                        // Erste 30 Sekunden warten (keine Anfragen)
                        if (pollIntervalActive) await interruptibleSleep(30000);

                        while (pollIntervalActive) {
                            let currentElapsed = Math.round((Date.now() - startTime) / 1000);
                            if (currentElapsed >= TIMEOUT_MAX) break;

                            // Gecachte Antwort von Tab-Rückkehr verwenden, falls vorhanden
                            let data;
                            if (cachedPollResponse) {
                                logDebug('Verwende gecachte Antwort von Tab-Rückkehr.');
                                data = cachedPollResponse;
                                cachedPollResponse = null;
                            } else {
                                logDebug(`Frage Status ab...`);
                                lastPollTime = Date.now();
                                try {
                                    const pollRes = await fetch(`${POLLER_URL}?jobId=${encodeURIComponent(jobId)}`, {
                                        method: 'GET', headers: { 'x-api-key': POLLER_API_KEY }
                                    });
                                    if (!pollRes.ok) { await interruptibleSleep(2000); continue; }
                                    data = await pollRes.json();
                                } catch(e) { logDebug(`Poll-Fehler: ${e.message}`); await interruptibleSleep(2000); continue; }
                            }
                            const jobStatus = data.status || 'pending';

                            if (jobStatus === 'pending') {
                                // 30s-90s: alle 15s | 90s-300s: alle 2s | 300s+: alle 30s
                                const waitSec = currentElapsed < 90 ? 15 : currentElapsed < 300 ? 2 : 30;
                                if (!pollIntervalActive) return;
                                await interruptibleSleep(waitSec * 1000);
                                continue;
                            }

                            pollIntervalActive = false; clearInterval(timerInterval); unlockEditor();
                            document.removeEventListener('visibilitychange', onVisibilityChange);
                            const finalDurationStr = formatDurationFriendly(Math.round((Date.now() - startTime) / 1000));
                            logDebug(`Job abgeschlossen: ${jobStatus}.`);

                            if (jobStatus === 'error') {
                                const errMsg = data.fixes || data.error || 'Unbekannter Fehler im KI-Agenten.';
                                logDebug(`Fehlerdetails vom Server: ${errMsg}`);

                                launcherTab.querySelector('span').innerText = '❌ KI-Fehler';
                                setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                                addMessage('<b>Fehlerdetails:</b> Bei der Verarbeitung ist ein Fehler aufgetreten. Details im Debug-Log.', 'error');
                                btnCheck.style.display = 'block'; btnCheck.disabled = false;
                                return;
                            }

                            if (jobStatus === 'success') {
                                launcherTab.querySelector('span').innerText = '✅ KI Fertig';
                                let newContent = data.content || null;
                                const fixesText = data.fixes || '';
                                
                                const korrektorMatch = fixesText.match(/<korrektor>([\s\S]*?)<\/korrektor>/i);
                                const verlinkerMatch = fixesText.match(/<verlinker>([\s\S]*?)<\/verlinker>/i);
                                let korrektorText = korrektorMatch ? korrektorMatch[1].trim() : null;
                                const verlinkerText = verlinkerMatch ? verlinkerMatch[1].trim() : null;

                                if (korrektorText) korrektorText = korrektorText.replace(/\. (Rechtschreibung|Grammatik|Die Rechtschreibung|Zur Rechtschreibung|Es wurden keine signifikanten)/gi, '.\n$1').replace(/\. (Die Shortcode|Shortcodes)/gi, '.\n$1');
                                if (!newContent) throw new Error('Erfolg gemeldet, aber kein Text gespeichert.');

                                newContent = cleanAIContent(newContent);
                                setStatusIconText('⏳', 'Schreibe Text in Editor...', null, '#8be9fd');
                                // new_text_content kept in IIFE scope for potential future use
                                
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
                                        const safeLine = escapeHTML(cleanLine);
                                        const div = document.createElement('div');
                                        if(cleanLine.toLowerCase().includes('keine korrek') || cleanLine.toLowerCase().includes('nicht')) {
                                            div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${safeLine}</span>`; div.style.marginTop = '6px';
                                        } else {
                                            div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${safeLine}</span>`; div.style.marginTop = '6px'; div.style.paddingLeft = '5px';
                                        }
                                        korrBox.appendChild(div);
                                    });
                                    resultsArea.appendChild(korrBox);
                                }

                                {
                                    const verlBox = document.createElement('div'); Object.assign(verlBox.style, { backgroundColor: '#2d2d30', padding: '12px', borderRadius: '6px', border: '1px solid #3a3a3c' });
                                    const lines = verlinkerText ? verlinkerText.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
                                    const linkCount = lines.filter(l => l.toLowerCase().startsWith('link')).length;
                                    const vTitle = document.createElement('div'); vTitle.innerHTML = `<span style="color:#50fa7b; font-weight:bold; font-size:14px;">🔗 ${linkCount === 1 ? 'Verlinkung' : 'Verlinkungen'}</span><hr style="border:0; border-top:1px solid #444; margin:8px 0;">`;
                                    verlBox.appendChild(vTitle);
                                    if (lines.length === 0) {
                                        const noLinks = document.createElement('div'); Object.assign(noLinks.style, { borderLeft: '3px solid #ffb86c', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                        noLinks.innerHTML = '<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">Keine passenden Verlinkungen gefunden.</span>';
                                        verlBox.appendChild(noLinks);
                                    }
                                    let currentGroup = null;
                                    lines.forEach(line => {
                                        let cleanLine = line.replace(/^[-*•#\d.]+\s*/, '');
                                        const lineLower = cleanLine.toLowerCase();
                                        const safeLine = escapeHTML(cleanLine).replace(/(https?:\/\/[^\s&<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #66d9ef; text-decoration: underline;">$1</a>');
                                        if (lineLower.startsWith('link')) {
                                            // URL und Linktext aus der Zeile extrahieren
                                            const urlMatch = cleanLine.match(/(https?:\/\/[^\s]+)/);
                                            const linkTextMatch = cleanLine.match(/[""„]([^""„"]+)[""„"]/);
                                            const linkUrl = urlMatch ? urlMatch[1] : null;
                                            const linkText = linkTextMatch ? linkTextMatch[1] : null;

                                            currentGroup = document.createElement('div'); Object.assign(currentGroup.style, { borderLeft: '3px solid #007acc', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0', position: 'relative', transition: 'opacity 0.3s, max-height 0.3s, margin 0.3s, padding 0.3s', overflow: 'hidden' });
                                            if (linkUrl) currentGroup.dataset.previewUrl = linkUrl;
                                            currentGroup.innerHTML = `<div>► <span style="color:#f8f8f2; font-weight:bold;">${safeLine}</span></div>`;

                                            // X-Button zum Entfernen des Links
                                            if (linkUrl) {
                                                const removeBtn = document.createElement('span');
                                                removeBtn.innerHTML = '✕';
                                                Object.assign(removeBtn.style, { position: 'absolute', top: '6px', right: '8px', cursor: 'pointer', color: '#ff5555', fontSize: '14px', fontWeight: 'bold', lineHeight: '1', opacity: '0.6', transition: 'opacity 0.2s' });
                                                removeBtn.onmouseover = () => removeBtn.style.opacity = '1'; removeBtn.onmouseout = () => removeBtn.style.opacity = '0.6';
                                                const groupRef = currentGroup;
                                                removeBtn.onclick = () => {
                                                    // Link aus dem Editor-Text entfernen (Linktext behalten)
                                                    let editorContent = '';
                                                    if (window.news_text_editor && typeof window.news_text_editor.getValue === 'function') {
                                                        editorContent = window.news_text_editor.getValue();
                                                    } else {
                                                        const el = document.getElementById('news_text');
                                                        if (el) editorContent = el.value;
                                                    }
                                                    // <a href="URL">text</a> → text (verschiedene Schreibweisen)
                                                    const escapedUrl = linkUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                                    const linkRegex = new RegExp(`<a\\s[^>]*href=["']${escapedUrl}["'][^>]*>(.*?)<\\/a>`, 'gi');
                                                    const newContent = editorContent.replace(linkRegex, '$1');
                                                    if (newContent !== editorContent) {
                                                        if (window.news_text_editor && typeof window.news_text_editor.setValue === 'function') {
                                                            window.news_text_editor.setValue(newContent, -1);
                                                        } else {
                                                            const el = document.getElementById('news_text');
                                                            if (el) el.value = newContent;
                                                        }
                                                        window.wfv4_news_changed = true;
                                                        logDebug(`Link entfernt: ${linkUrl}`);
                                                    } else {
                                                        logDebug(`Link nicht im Text gefunden: ${linkUrl}`);
                                                    }
                                                    // Box ausblenden mit Animation
                                                    groupRef.style.maxHeight = groupRef.scrollHeight + 'px';
                                                    requestAnimationFrame(() => { groupRef.style.opacity = '0'; groupRef.style.maxHeight = '0'; groupRef.style.margin = '0'; groupRef.style.padding = '0'; });
                                                    setTimeout(() => groupRef.remove(), 350);
                                                };
                                                currentGroup.appendChild(removeBtn);
                                            }

                                            verlBox.appendChild(currentGroup);
                                        } else if (lineLower.startsWith('begründung') && currentGroup) {
                                            const reasonDiv = document.createElement('div'); reasonDiv.innerHTML = `<span style="color:#cccccc;">${safeLine}</span>`; reasonDiv.style.marginTop = '6px';
                                            currentGroup.appendChild(reasonDiv);
                                        } else {
                                            currentGroup = null;
                                            const div = document.createElement('div'); Object.assign(div.style, { marginTop: '6px', paddingLeft: '5px' });
                                            if(lineLower.includes('keine') || lineLower.includes('nicht') || lineLower.includes('wurden')) {
                                                Object.assign(div.style, { borderLeft: '3px solid #ffb86c', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                                div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${safeLine}</span>`;
                                            } else {
                                                div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${safeLine}</span>`;
                                            }
                                            verlBox.appendChild(div);
                                        }
                                    });
                                    resultsArea.appendChild(verlBox);

                                    // --- Link-Vorschau via wfv4_link_preview ---
                                    wfv4_link_preview.attach(verlBox, '[data-preview-url]', el => el.dataset.previewUrl);
                                }

                                // Auto-Resize: Höhe an Inhalt anpassen
                                requestAnimationFrame(() => {
                                    const headerH = header.offsetHeight;
                                    const footerH = footer.offsetHeight;
                                    const contentH = contentArea.scrollHeight;
                                    const needed = headerH + contentH + footerH + 2;
                                    const maxH = window.innerHeight - 40;
                                    terminalContainer.style.height = Math.min(needed, maxH) + 'px';
                                });
                            }
                        }
                    } catch (pollErr) {
                        if (pollIntervalActive) {
                            pollIntervalActive = false; clearInterval(timerInterval); unlockEditor();
                            document.removeEventListener('visibilitychange', onVisibilityChange);
                            logDebug(`Polling-Fehler: ${pollErr.message}`);
                            launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                            btnCheck.style.display = 'block'; btnCheck.disabled = false;
                            setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                            addMessage('Bei der Statusabfrage ist ein Fehler aufgetreten. Details im Debug-Log.', 'error');
                        }
                    }
                })();
            } catch (error) {
                pollIntervalActive = false; clearInterval(timerInterval); unlockEditor();
                if (typeof onVisibilityChange === 'function') document.removeEventListener('visibilitychange', onVisibilityChange);
                logDebug(`Allgemeiner Fehler: ${error.message}`);
                launcherTab.querySelector('span').innerText = '🤖 KI-Korrektor';
                btnCheck.style.display = 'block'; btnCheck.disabled = false;
                setStatusIconText('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                addMessage('Ein unerwarteter Fehler ist aufgetreten. Details im Debug-Log.', 'error');
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