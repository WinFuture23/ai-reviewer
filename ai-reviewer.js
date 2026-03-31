/**
 * wfv4_ai_reviewer — AI-powered article review widget for WinFuture.de.
 *
 * Sends the current editor content to a Make.com backend (via Val.town proxy),
 * polls for the result (via Val.town Poller-DB), and displays corrections and
 * link suggestions in a terminal-style overlay. Auth is handled via HMAC-SHA256
 * tokens injected by the PHP integration class (wfv4_ai_reviewer::render).
 *
 * @author  mesios
 * @version 3 2026-03-19
 * @see     docs/winfuture-integration.php
 */
(function() {
    // Allowed user IDs (wfv4uid cookie)
    const ALLOWED_USERS = [1, 124363];

    // Check user access before anything else
    const uid_match = document.cookie.match( /(?:^|;\s*)wfv4uid=(\d+)/ );
    if( !uid_match || !ALLOWED_USERS.includes( Number( uid_match[1] ) ) ) return;

    // Guard: prevent double initialisation when script is included twice
    if (window.wfv4_ai_reviewer_loaded) return;
    window.wfv4_ai_reviewer_loaded = true;

    // --- CSS ANIMATIONS (global, injected once) ---
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

        /**
         * Detect charset from raw bytes by scanning for meta charset declaration.
         * Falls back to 'utf-8' if nothing is found.
         */
        function detect_charset( raw_bytes ) {
            // Quick ASCII-safe scan of first 2 KB for charset declaration
            const peek = new TextDecoder( 'ascii' ).decode( raw_bytes.slice( 0, 2048 ) );
            // Match: <meta ... charset=iso-8859-1 /> or <meta charset="utf-8">
            const m = peek.match( /charset=["']?([a-zA-Z0-9_-]+)/i );
            return m ? m[1].toLowerCase() : 'utf-8';
        }

        /**
         * Maximum bytes to read per page. OG meta tags end before 36 KB on
         * all known winfuture.de page types (news, video, download, special,
         * faq, infografik, thema). 40 KB gives ~10% safety buffer.
         */
        const HEAD_BYTE_LIMIT = 40960;

        // Fetch only the first HEAD_BYTE_LIMIT bytes, detect charset, extract OG metadata
        async function fetch_meta( url ) {
            if (cache.has( url )) return;
            cache.set( url, null );
            try {
                const resp = await fetch( url, { credentials: 'same-origin' } );
                if (!resp.ok) return;
                // Stream only HEAD_BYTE_LIMIT bytes, then abort (saves 80-90% bandwidth)
                const reader = resp.body.getReader();
                const chunks = [];
                let total = 0;
                while (total < HEAD_BYTE_LIMIT) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push( value );
                    total += value.length;
                }
                reader.cancel(); // abort remaining download
                // Merge chunks into single ArrayBuffer
                const buf = new Uint8Array( total );
                let offset = 0;
                for (const chunk of chunks) {
                    buf.set( chunk, offset );
                    offset += chunk.length;
                }
                const charset = detect_charset( buf );
                const html = new TextDecoder( charset ).decode( buf );
                const head_end = html.indexOf( '</head>' );
                const head_html = html.substring( 0, head_end > 0 ? head_end + 7 : html.length );
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
                position: 'fixed', zIndex: '1000000',
                minWidth: '360px', maxWidth: 'min(600px, calc(100vw - 24px))',
                width: 'auto',
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
                ? `<img src="${esc( data.image )}" style="width:160px; min-width:160px; height:auto; object-fit:contain; border-radius:8px; background:#2a2a2c;" onerror="this.style.display='none'">`
                : '';
            const desc_html = data.description
                ? `<div style="font-size:12.5px; color:#ccc; line-height:1.45; margin-top:6px; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${esc( data.description )}</div>`
                : '';
            c.innerHTML = `<div style="display:flex; gap:12px; padding:10px; align-items:flex-start;">`
                + img_html
                + `<div style="flex:1; min-width:0; display:flex; flex-direction:column;">`
                + `<div style="font-size:15px; font-weight:700; color:#ffffff; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-wrap:balance;">${esc( data.title )}</div>`
                + desc_html
                + `<div style="text-align:right; font-size:10px; color:#666; margin-top:4px;">↗ Artikel öffnen</div>`
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

    // --- MODULE STATE ---
    let terminal_container = null;  // Main overlay DOM element
    let launcher_tab = null;        // Bottom-right launcher tab
    let poll_active = false;        // True while a job is being polled
    let cached_diff = { content: null, teaser: null }; // Diffchecker cache per field
    let debug_log = [];             // Debug messages (copyable via header button)
    let backup_data = null;         // All field values before AI modification (for undo)
    let btn_check = null;           // "Artikel überprüfen" button reference
    let content_info = null;        // Detected content type { type, id, config }

    // --- CONFIGURATION ---
    // Diffchecker API accounts (Base64 to avoid plain-text in source)
    const _da = ['U2s=','U2ViYXN0aWFuLkt1aGJhY2g=','bWVzaW9z','Q29kaW5n','RGlpZmY='];
    const _dd = 'QFdpbkZ1dHVyZS5kZQ==';
    const DIFF_ACCOUNTS = _da.map(a => atob(a) + atob(_dd));

    // Val.town proxy endpoints
    const PROXY_URL = 'https://mesios--43bb6c1c197111f18d1642dde27851f2.web.val.run';
    const POLLER_URL = 'https://mesios--f12a09281c8f11f1845142dde27851f2.web.val.run';
    const POLLER_API_KEY = 'wf_super_secret_key_2026_xyz';

    // --- CONTENT TYPE CONFIGURATION ---
    // Each content type maps to the DOM element IDs used on its editor page.
    // ace_var: name of the window-level Ace editor instance (convention: {textarea_id}_editor)
    // Submit functions per content type (form submission after save)
    const SUBMIT_FUNCTIONS = {
        6: 'wfv4_news_submit',  // News: global function
        8: 'dl_submit_check',   // Downloads: form onsubmit
        5: 'video_edit_form_submit', // Videos: form onsubmit
        1: 'faqcheck'           // FAQ: form onsubmit
    };

    // Form IDs per content type (for non-News types that use form.submit())
    const FORM_IDS = {
        8: 'dlc-edit',
        5: 'video_edit_form',
        1: 'faq_edit_form'
    };

    const CONTENT_TYPES = {
        6: { // News
            name: 'news',
            fields: {
                headline: { id: 'subject', type: 'input', ace_var: 'news_title_editor' },
                teaser:   { id: 'news_text_teaser', type: 'textarea', ace_var: 'news_text_teaser_editor' },
                content:  { id: 'news_text', type: 'textarea', ace_var: 'news_text_editor' }
            }
        },
        8: { // Downloads
            name: 'download',
            fields: {
                headline:      { id: 'subject', type: 'input', ace_var: 'dl_title_editor' },
                software_name: { id: 'program_name', type: 'input' },
                content:       { id: 'download_text', type: 'textarea', ace_var: 'dl_text_editor' }
            }
        },
        5: { // Videos
            name: 'video',
            fields: {
                headline: { id: 'subject', type: 'input', ace_var: 'video_title_editor' },
                content:  { id: 'video_description', type: 'textarea', ace_var: 'video_text_editor' }
            }
        },
        1: { // FAQ
            name: 'faq',
            fields: {
                headline: { id: 'question', type: 'input', ace_var: 'faq_title_editor' },
                content:  { id: 'text', type: 'textarea', ace_var: 'faq_text_editor' }
            }
        }
        // TODO: tags — Element-ID noch unbekannt, spaeter hier ergaenzen
        // TODO: screenshot_content, screenshot_all — spaeter ergaenzen
    };

    /**
     * Detect current content type and ID from window.wfv4_content.
     * Falls back to News (type 6) if the global is missing but #news_text exists.
     * @return {object|null} { type, id, config } or null
     */
    function detect_content_info() {
        const wfv4 = window.wfv4_content;

        // Sicherheitsrichtlinie §19: Ungueltige Werte abweisen, nicht korrigieren
        if( wfv4 && typeof wfv4.type !== 'undefined' ) {
            const type_id = parseInt( wfv4.type, 10 );
            const cid = parseInt( wfv4.id, 10 );

            if( isNaN( type_id ) || isNaN( cid ) || cid < 0 ) {
                log_debug( 'Fehler: wfv4_content enthaelt ungueltige Werte.' );
                return null;
            }

            const config = CONTENT_TYPES[type_id];

            if( config ) {
                log_debug( `Content-Type erkannt: ${config.name} (Typ ${type_id}, ID ${cid}).` );
                return { type: type_id, id: cid, config: config };
            }
            log_debug( 'Warnung: Unbekannter Content-Type.' );
        }

        // Fallback: auto-detect based on known DOM elements
        if( document.getElementById( 'news_text' ) ) {
            log_debug( 'Fallback: news_text gefunden, verwende News-Konfiguration.' );
            return { type: 6, id: 0, config: CONTENT_TYPES[6] };
        }

        log_debug( 'Fehler: Content-Type konnte nicht ermittelt werden.' );
        return null;
    }

    /**
     * Read a field value from ACE editor (preferred) or DOM element (fallback).
     * @param {object} field_cfg field config from CONTENT_TYPES
     * @return {string}
     */
    function read_field_value( field_cfg ) {
        if( field_cfg.ace_var ) {
            const editor = window[field_cfg.ace_var];

            if( editor && typeof editor.getValue === 'function' ) {
                return editor.getValue();
            }
        }
        const el = document.getElementById( field_cfg.id );
        return el ? el.value : '';
    }

    /**
     * Write a value to ACE editor (preferred) or DOM element (fallback).
     * Sets wfv4_news_changed flag on success.
     * @param {object} field_cfg field config from CONTENT_TYPES
     * @param {string} value the new value
     * @return {boolean} true if written successfully
     */
    function write_field_value( field_cfg, value ) {
        if( field_cfg.ace_var ) {
            const editor = window[field_cfg.ace_var];

            if( editor && typeof editor.setValue === 'function' ) {
                editor.setValue( value, -1 );
                window.wfv4_news_changed = true;
                return true;
            }
        }
        const el = document.getElementById( field_cfg.id );

        if( el ) {
            el.value = value;
            window.wfv4_news_changed = true;
            return true;
        }
        return false;
    }

    /**
     * Read missing special links from the #missing_specials UL element.
     * Each LI contains an <a> (name) and an <input> (URL).
     * @return {Array<{name: string, url: string}>}
     */
    function read_missing_specials() {
        const ul = document.getElementById( 'missing_specials' );

        if( !ul ) return [];
        const items = [];
        const lis = ul.querySelectorAll( 'li' );

        lis.forEach( function( li ) {
            const a = li.querySelector( 'a' );
            const input = li.querySelector( 'input' );

            if( a && input ) {
                items.push( { name: a.textContent.trim(), url: input.value.trim() } );
            }
        });
        return items;
    }

    /**
     * Gather all article data for the current content type.
     * Returns an object with content_type, content_id, and all field values.
     * @param {object} ci content_info from detect_content_info()
     * @return {object}
     */
    function gather_article_data( ci ) {
        const data = {
            content_type: ci.type,
            content_id: ci.id
        };

        for( const key in ci.config.fields ) {
            const value = read_field_value( ci.config.fields[key] );

            if( value ) {
                data[key] = value;
            }
        }

        const specials = read_missing_specials();

        if( specials.length > 0 ) {
            data.missing_specials = specials;
        }
        return data;
    }

    // --- UTILITY FUNCTIONS ---

    /** Append a timestamped message to the debug log and browser console. */
    function log_debug(msg) {
        const time = new Date().toLocaleTimeString('de-DE');
        debug_log.push(`[${time}] ${msg}`);
        console.log(`🤖 AI-Reviewer [${time}]: ${msg}`);
    }

    /** Format seconds as human-readable German duration string (e.g. "2 Minuten 15 Sekunden"). */
    function format_duration_friendly(total_seconds) {
        const m = Math.floor(total_seconds / 60);
        const s = total_seconds % 60;
        const min_str = m === 1 ? 'Minute' : 'Minuten';
        const sek_str = s === 1 ? 'Sekunde' : 'Sekunden';
        if (m > 0 && s > 0) return `${m} ${min_str} ${s} ${sek_str}`;
        if (m > 0) return `${m} ${min_str}`;
        return `${s} ${sek_str}`;
    }

    /** Escape HTML special characters to prevent XSS (Sicherheitsrichtlinie §14/§24). */
    function escape_html(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /** Strip JSON wrapper if backend returns { Content: "..." } instead of raw text. */
    function clean_ai_content(text) {
        if (!text) return text;
        let t = text.trim();
        if (t.startsWith('{') && t.endsWith('}')) {
            try {
                let parsed = JSON.parse(t);
                if (parsed.Content) return parsed.Content;
                if (parsed.content) return parsed.content;
            } catch(e) {
                log_debug('Hinweis: Text sah wie JSON aus, war aber nicht valide.');
            }
        }
        return t; 
    }

    /** Lock all editor fields for the current content type with overlays. */
    function lock_editor() {
        if( !content_info ) return;
        const fields = content_info.config.fields;

        for( const key in fields ) {
            const field = fields[key];
            let ace_locked = false;

            if( field.ace_var ) {
                const editor = window[field.ace_var];

                if( editor && typeof editor.setReadOnly === 'function' ) {
                    ace_locked = true;
                    editor.setReadOnly( true );
                    const container = editor.container;

                    if( container ) {
                        container.style.transition = 'opacity 0.3s ease';
                        container.style.opacity = '0.5';
                        const overlay_id = 'ai-reviewer-overlay-' + field.id;

                        if( !document.getElementById( overlay_id ) ) {
                            const overlay = document.createElement( 'div' );
                            overlay.id = overlay_id;
                            Object.assign( overlay.style, {
                                position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                                zIndex: '9999', cursor: 'not-allowed', backgroundColor: 'rgba(255, 255, 255, 0.1)'
                            });
                            container.appendChild( overlay );
                        }
                    }
                }
            }

            if( !ace_locked ) {
                const el = document.getElementById( field.id );

                if( el ) {
                    el.disabled = true;
                    el.style.transition = 'opacity 0.3s ease';
                    el.style.opacity = '0.5';
                    el.style.cursor = 'not-allowed';
                }
            }
        }
        log_debug( 'Editor-Felder gesperrt.' );
    }

    /** Unlock all editor fields for the current content type. */
    function unlock_editor() {
        if( !content_info ) return;
        const fields = content_info.config.fields;

        for( const key in fields ) {
            const field = fields[key];
            let ace_unlocked = false;

            if( field.ace_var ) {
                const editor = window[field.ace_var];

                if( editor && typeof editor.setReadOnly === 'function' ) {
                    ace_unlocked = true;
                    editor.setReadOnly( false );
                    const container = editor.container;

                    if( container ) {
                        container.style.opacity = '1';
                        const overlay = document.getElementById( 'ai-reviewer-overlay-' + field.id );

                        if( overlay ) overlay.remove();
                    }
                }
            }

            if( !ace_unlocked ) {
                const el = document.getElementById( field.id );

                if( el ) {
                    el.disabled = false;
                    el.style.opacity = '1';
                    el.style.cursor = '';
                }
            }
        }
        log_debug( 'Editor-Felder freigegeben.' );
    }

    /** Show a full-screen overlay with the Diffchecker HTML comparison in a sandboxed iframe. */
    /**
     * Show diff overlay with one or more sections.
     * @param {Array<{label: string, html: string}>} sections
     */
    function show_diff_overlay(sections) {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: '9999999', display: 'flex', flexDirection: 'column', padding: '20px', boxSizing: 'border-box' });
        const header_bar = document.createElement('div'); Object.assign(header_bar.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', color: '#fff', fontFamily: 'sans-serif' });
        header_bar.innerHTML = '<h2 style="margin:0;">🔍 Diff-Ansicht: Vorher vs. Nachher</h2>';
        const close_diff_btn = document.createElement('button'); close_diff_btn.innerHTML = '✖ Ansicht schließen';
        Object.assign(close_diff_btn.style, { backgroundColor: '#ff5555', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' });
        function close_diff() { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', esc_handler); }
        close_diff_btn.onclick = close_diff; header_bar.appendChild(close_diff_btn);
        overlay.appendChild(header_bar);

        const scroll_wrap = document.createElement('div');
        const is_single = sections.length === 1;
        Object.assign(scroll_wrap.style, { flexGrow: '1', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '4px' });

        for( let i = 0; i < sections.length; i++ ) {
            const iframe = document.createElement('iframe');
            iframe.sandbox = 'allow-same-origin'; // Sicherheitsrichtlinie §20: minimal permissions
            Object.assign(iframe.style, { width: '100%', backgroundColor: '#fff', border: 'none', borderRadius: '6px', flexShrink: '0' });

            if( is_single ) {
                iframe.style.flexGrow = '1';
                iframe.style.height = '100%';
            } else if( i === 0 ) {
                // Teaser: auto-size to content height after load
                iframe.style.height = '0';
                iframe.onload = function() {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow.document;
                        const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
                        iframe.style.height = Math.min( h + 4, Math.round( window.innerHeight * 0.35 ) ) + 'px';
                    } catch(e) { iframe.style.height = '20vh'; }
                };
            } else {
                // Content: fill remaining space
                iframe.style.flexGrow = '1';
                iframe.style.minHeight = '40vh';
            }

            iframe.srcdoc = sections[i].html;
            scroll_wrap.appendChild(iframe);
        }

        overlay.appendChild(scroll_wrap); document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        const esc_handler = (e) => { if (e.key === 'Escape') close_diff(); };
        document.addEventListener('keydown', esc_handler);
    }

    // --- WIDGET INITIALISATION (LAUNCHER TAB) ---
    /** Create and attach the bottom-right launcher tab. Terminal is built lazily on first click. */
    function init_widget() {
        launcher_tab = document.createElement('div');
        launcher_tab.id = 'ai-reviewer-launcher';
        Object.assign(launcher_tab.style, {
            position: 'fixed', bottom: '0', right: '40px', backgroundColor: '#007acc', color: '#fff',
            padding: '10px 20px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
            cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold',
            fontSize: '14px', zIndex: '999999', boxShadow: '0 -2px 10px rgba(0,0,0,0.3)',
            transition: 'background-color 0.2s', display: 'flex', alignItems: 'center', gap: '8px'
        });
        launcher_tab.innerHTML = '<span>🤖 KI-Korrektor</span>';

        launcher_tab.onmouseover = () => launcher_tab.style.backgroundColor = '#005f9e';
        launcher_tab.onmouseout = () => launcher_tab.style.backgroundColor = '#007acc';

        launcher_tab.onclick = () => {
            launcher_tab.style.display = 'none';
            if (!terminal_container) {
                build_terminal(); // Lazy Loading: Erstellt das Terminal beim ersten Klick
            } else {
                terminal_container.style.display = 'flex'; // Zeigt das versteckte Terminal wieder
            }
            // Artikel-Prüfung direkt auslösen (Button ist initial hidden, nur bei Fehler sichtbar)
            requestAnimationFrame(() => setTimeout(() => { if (btn_check && !btn_check.disabled) btn_check.click(); }, 100));
        };

        document.body.appendChild(launcher_tab);
    }

    // --- MAIN TERMINAL (OVERLAY UI) ---
    /** Build the terminal overlay with header, content area, footer buttons, and resize handles. */
    function build_terminal() {
        terminal_container = document.createElement('div');
        terminal_container.id = 'ai-reviewer-terminal';
        Object.assign(terminal_container.style, {
            position: 'fixed', bottom: '20px', right: '20px', width: '650px', height: '600px',
            minWidth: '400px', minHeight: '350px', backgroundColor: '#1e1e1e', color: '#f8f8f2', 
            fontFamily: 'Consolas, "Courier New", monospace', border: '1px solid #444', 
            borderRadius: '6px', zIndex: '999999', display: 'flex', flexDirection: 'column', 
            boxShadow: '0 10px 40px rgba(0,0,0,0.9)', fontSize: '13px', overflow: 'hidden' 
        });

        // Resize Handles
        const top_handle = document.createElement('div'); Object.assign(top_handle.style, { position: 'absolute', top: '-2px', left: '0', right: '0', height: '6px', cursor: 'ns-resize', zIndex: '10' });
        const left_handle = document.createElement('div'); Object.assign(left_handle.style, { position: 'absolute', top: '0', left: '-2px', bottom: '0', width: '6px', cursor: 'ew-resize', zIndex: '10' });
        const corner_handle = document.createElement('div'); Object.assign(corner_handle.style, { position: 'absolute', top: '-4px', left: '-4px', width: '12px', height: '12px', cursor: 'nwse-resize', zIndex: '11' });

        let is_resizing = false; let resize_type = '';
        function init_resize(e, type) { e.preventDefault(); is_resizing = true; resize_type = type; document.addEventListener('mousemove', handle_mouse_move); document.addEventListener('mouseup', stop_resize); document.body.style.userSelect = 'none'; }
        function handle_mouse_move(e) { if (!is_resizing) return; if (resize_type === 'left' || resize_type === 'both') { const newWidth = window.innerWidth - e.clientX - 20; if (newWidth > 400) terminal_container.style.width = newWidth + 'px'; } if (resize_type === 'top' || resize_type === 'both') { const newHeight = window.innerHeight - e.clientY - 20; if (newHeight > 300) terminal_container.style.height = newHeight + 'px'; } }
        function stop_resize() { is_resizing = false; document.removeEventListener('mousemove', handle_mouse_move); document.removeEventListener('mouseup', stop_resize); document.body.style.userSelect = ''; }

        top_handle.addEventListener('mousedown', (e) => init_resize(e, 'top')); left_handle.addEventListener('mousedown', (e) => init_resize(e, 'left')); corner_handle.addEventListener('mousedown', (e) => init_resize(e, 'both'));
        terminal_container.appendChild(top_handle); terminal_container.appendChild(left_handle); terminal_container.appendChild(corner_handle);

        // Header
        const header = document.createElement('div');
        Object.assign(header.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 15px', backgroundColor: '#333333', borderBottom: '1px solid #222', color: '#ccc', fontSize: '12px', userSelect: 'none' });
        header.innerHTML = '<span>🤖 KI-Korrektor & Verlinker</span>';
        
        const header_right = document.createElement('div'); Object.assign(header_right.style, { display: 'flex', gap: '15px', alignItems: 'center' });

        const debug_btn = document.createElement('span'); debug_btn.innerHTML = 'Debug';
        Object.assign(debug_btn.style, { cursor: 'pointer', color: '#6272a4', fontSize: '11px', transition: 'color 0.2s' });
        debug_btn.onmouseover = () => debug_btn.style.color = '#8be9fd'; debug_btn.onmouseout = () => debug_btn.style.color = '#6272a4';
        debug_btn.onclick = () => {
            const meta = `URL: ${location.href}\nJobID: ${debug_log.find(l => l.includes('JobID:'))?.match(/JobID:\s*(\S+)/)?.[1] || 'n/a'}\n\n`;
            navigator.clipboard.writeText(meta + debug_log.join('\n')).then(() => {
                const old = debug_btn.innerHTML; debug_btn.innerHTML = 'Kopiert!'; setTimeout(() => debug_btn.innerHTML = old, 2000);
            });
        };

        // MINIMIEREN STATT LÖSCHEN
        const close_header_btn = document.createElement('span'); close_header_btn.innerHTML = '▼ Verbergen';
        Object.assign(close_header_btn.style, { cursor: 'pointer', fontWeight: 'bold', color: '#ffb86c', transition: 'color 0.2s' });
        close_header_btn.onmouseover = () => close_header_btn.style.color = '#ff9900'; close_header_btn.onmouseout = () => close_header_btn.style.color = '#ffb86c';
        close_header_btn.onclick = () => { terminal_container.style.display = 'none'; launcher_tab.style.display = 'flex'; wfv4_link_preview.destroy(); };

        header_right.appendChild(debug_btn); header_right.appendChild(close_header_btn);
        header.appendChild(header_right);

        // Content Area
        const content_area = document.createElement('div');
        Object.assign(content_area.style, { flexGrow: '1', overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '12px', wordWrap: 'break-word', backgroundColor: '#1e1e1e' });
        const status_el = document.createElement('div'); status_el.style.fontWeight = 'bold'; content_area.appendChild(status_el);
        const results_area = document.createElement('div'); Object.assign(results_area.style, { display: 'flex', flexDirection: 'column', gap: '12px' }); 
        content_area.appendChild(results_area);

        // Footer & Buttons
        const footer = document.createElement('div');
        Object.assign(footer.style, { padding: '15px', backgroundColor: '#252526', display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'stretch', borderTop: '1px solid #333', width: '100%', boxSizing: 'border-box' });

        btn_check = document.createElement('button'); btn_check.innerHTML = '🚀 Artikel überprüfen';
        Object.assign(btn_check.style, { backgroundColor: '#007acc', color: '#ffffff', border: '1px solid #005f9e', padding: '10px 24px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '14px', transition: 'all 0.2s ease', outline: 'none', display: 'none' });
        btn_check.onmouseover = () => btn_check.style.backgroundColor = '#005f9e'; btn_check.onmouseout = () => btn_check.style.backgroundColor = '#007acc';

        const ACTION_BTN_STYLE = { padding: '10px 5px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 'bold', fontSize: '13px', outline: 'none', border: 'none', display: 'none', justifyContent: 'center', alignItems: 'center', gap: '6px', transition: 'all 0.2s ease', flex: '1', whiteSpace: 'nowrap' };

        const btn_diff = document.createElement('button'); btn_diff.innerHTML = '🔍 Unterschiede anzeigen';
        Object.assign(btn_diff.style, ACTION_BTN_STYLE, { backgroundColor: '#f1fa8c', color: '#282a36' });
        btn_diff.onmouseover = () => btn_diff.style.backgroundColor = '#e2eb70'; btn_diff.onmouseout = () => btn_diff.style.backgroundColor = '#f1fa8c';

        const btn_undo = document.createElement('button'); btn_undo.innerHTML = '↺ Rückgängig machen';
        Object.assign(btn_undo.style, ACTION_BTN_STYLE, { backgroundColor: '#d9534f', color: '#ffffff' });
        btn_undo.onmouseover = () => btn_undo.style.backgroundColor = '#c9302c'; btn_undo.onmouseout = () => btn_undo.style.backgroundColor = '#d9534f';

        const btn_close_bottom = document.createElement('button'); btn_close_bottom.innerHTML = '💾 Speichern';
        btn_close_bottom.className = 'css_button green';
        Object.assign(btn_close_bottom.style, ACTION_BTN_STYLE, { backgroundColor: '#008800', color: '#fff', borderColor: '#7dc07d #003300 #003300 #7dc07d' });
        btn_close_bottom.onmouseover = () => btn_close_bottom.style.backgroundColor = '#006600'; btn_close_bottom.onmouseout = () => btn_close_bottom.style.backgroundColor = '#008800';
        btn_close_bottom.onclick = () => {
            // Content-type-specific form submission
            if( content_info ) {
                const type_id = content_info.type;
                const submit_fn = SUBMIT_FUNCTIONS[type_id];
                const form_id = FORM_IDS[type_id];

                if( type_id === 6 && typeof window[submit_fn] === 'function' ) {
                    // News: call global submit function directly
                    window[submit_fn]();
                } else if( form_id ) {
                    // Downloads, Videos, FAQ: submit the form (requestSubmit triggers onsubmit handlers)
                    const form = document.getElementById( form_id );

                    if( form ) form.requestSubmit();
                }
            }
            terminal_container.style.display = 'none';
        };

        footer.appendChild(btn_check); footer.appendChild(btn_diff); footer.appendChild(btn_undo); footer.appendChild(btn_close_bottom);
        terminal_container.appendChild(header); terminal_container.appendChild(content_area); terminal_container.appendChild(footer); 
        document.body.appendChild(terminal_container);

        /** Update the status line in the content area (icon, text, optional subtitle). */
        function set_status(icon, main_text, sub_text = null, color = '#f8f8f2', write_to_debug = true) {
            status_el.innerHTML = `<div style="display: flex; align-items: flex-start; gap: 8px; color: ${color};"><span style="line-height: 1.4; font-size: 14px; width: 20px; text-align: center;">${icon}</span><div style="display: flex; flex-direction: column;"><span style="line-height: 1.4;">${main_text}</span>${sub_text ? `<span style="font-size: 11px; color: #aaaaaa; font-weight: normal; margin-top: 2px;">${sub_text}</span>` : ''}</div></div>`;
            if (write_to_debug) log_debug(`Status: ${main_text}`);
        }

        /** Append a message to the results area (types: info, error, warning, success). */
        function add_message(msg, type = 'info') {
            const entry = document.createElement('div'); entry.innerHTML = msg;
            if (type === 'error') entry.style.color = '#ff5555'; if (type === 'warning') entry.style.color = '#ffb86c'; if (type === 'success') entry.style.color = '#50fa7b';
            results_area.appendChild(entry); content_area.scrollTop = content_area.scrollHeight;
        }

        set_status('🟢', 'Bereit.', null, '#50fa7b');

        // --- DIFFCHECKER BUTTON ---
        /** Fetch word-level diff for content (and teaser if present) via Diffchecker API. */
        async function fetch_diff(field_key) {
            const current_text = content_info ? read_field_value( content_info.config.fields[field_key] ) : '';
            const original_text = (backup_data && backup_data[field_key]) || '';

            // Return cached result if inputs unchanged
            if( cached_diff[field_key] && cached_diff[field_key].left === original_text && cached_diff[field_key].right === current_text ) {
                return cached_diff[field_key].html;
            }

            const random_email = DIFF_ACCOUNTS[Math.floor(Math.random() * DIFF_ACCOUNTS.length)];
            const res = await fetch(`https://api.diffchecker.com/public/text?output_type=html&email=${encodeURIComponent(random_email)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ left: original_text, right: current_text, diff_level: 'word' })
            });

            if( !res.ok ) throw new Error( `HTTP ${res.status}` );
            const html = await res.text();
            cached_diff[field_key] = { left: original_text, right: current_text, html: html };
            return html;
        }

        btn_diff.onclick = async () => {
            const old_btn_text = btn_diff.innerHTML; btn_diff.innerHTML = '⏳ Lade...'; btn_diff.disabled = true;
            try {
                const has_teaser = content_info && content_info.config.fields.teaser;
                const sections = [];

                if( has_teaser ) {
                    log_debug( 'Rufe Diffchecker API auf (Teaser + Content)...' );
                    const teaser_html = await fetch_diff( 'teaser' );
                    sections.push( { label: 'Teaser', html: teaser_html } );
                } else {
                    log_debug( 'Rufe Diffchecker API auf (Content)...' );
                }

                const content_html = await fetch_diff( 'content' );
                sections.push( { label: 'Content', html: content_html } );

                show_diff_overlay( sections );
            } catch (err) {
                // Sicherheitsrichtlinie §12: Details nur ins Debug-Log, nicht an den User
                log_debug( `DiffChecker-Fehler: ${err.message}` );
                add_message( '<b>Hinweis:</b> Konnte DiffChecker API nicht laden.', 'warning' );
            } finally {
                btn_diff.innerHTML = old_btn_text; btn_diff.disabled = false;
            }
        };

        /** Restore original editor content from backup. */
        btn_undo.onclick = () => {
            if( backup_data && content_info ) {
                for( const key in backup_data ) {
                    if( content_info.config.fields[key] ) write_field_value( content_info.config.fields[key], backup_data[key] );
                }
            }
            add_message( '<b>Hinweis:</b> Originaltext wurde wiederhergestellt.', 'warning' ); log_debug( 'Originaltext wiederhergestellt.' );
        };

        // --- HAUPT-POLLING LOGIK ---
        btn_check.addEventListener('click', async () => {
            btn_check.disabled = true; btn_check.style.display = 'none'; results_area.innerHTML = ''; debug_log = []; cached_diff = { content: null, teaser: null }; 

            log_debug('Starte Überprüfungsprozess...');
            let timer_interval;
            poll_active = true;
            launcher_tab.querySelector('span').innerText = '⏳ KI arbeitet...';

            let manual_poll_area = null;

            try {
                set_status( '⏳', 'Erkenne Content-Type...', null, '#8be9fd' );
                content_info = detect_content_info();

                if( !content_info ) throw new Error( 'Content-Type konnte nicht ermittelt werden. Abbruch.' );

                set_status( '⏳', 'Lese Editor-Inhalte aus...', null, '#8be9fd' );
                const article_data = gather_article_data( content_info );

                if( !article_data.content || !article_data.content.trim() ) throw new Error( 'Der Editor ist leer. Abbruch.' );

                // Backup all field values for undo
                backup_data = {};

                for( const key in content_info.config.fields ) {
                    backup_data[key] = read_field_value( content_info.config.fields[key] );
                }

                lock_editor();

                const job_id = 'wf_job_' + Date.now() + '_' + Math.floor( Math.random() * 10000 );
                const reviewer_auth = window.wfv4_ai_reviewer_auth || {};
                const auth_headers = reviewer_auth.token ? {
                    'X-Auth-Token': reviewer_auth.token,
                    'X-Auth-Ts': String( reviewer_auth.ts ),
                    'X-Auth-Ct': String( content_info.type ),
                    'X-Auth-Cid': String( content_info.id )
                } : {};

                if( !reviewer_auth.token ) log_debug( 'Warnung: Kein Auth-Token gefunden (window.wfv4_ai_reviewer_auth fehlt).' );

                log_debug( `Sende Artikel an Proxy. Content-Type: ${content_info.config.name}, ID: ${content_info.id}. JobID: ${job_id}` );
                const start_res = await fetch( PROXY_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth_headers },
                    body: JSON.stringify( { action: 'start', jobId: job_id, ...article_data } )
                });

                if( !start_res.ok ) {
                    // Sicherheitsrichtlinie §12: keine Details an den Client
                    log_debug( `Start-Request fehlgeschlagen: HTTP ${start_res.status}` );

                    if( start_res.status === 403 ) {
                        poll_active = false; unlock_editor();
                        launcher_tab.querySelector('span').innerText = '🔑 Token abgelaufen';
                        log_debug( 'Token abgelaufen oder ungueltig. Seite muss neu geladen werden.' );
                        set_status( '🔑', 'Sitzung abgelaufen.', 'Bitte Seite neu laden, um ein neues Token zu erhalten.', '#ffb86c', true );
                        add_message( '<b>Das Sicherheits-Token ist abgelaufen.</b> Bitte laden Sie die Seite neu.', 'warning' );
                        const reload_btn = document.createElement('button');
                        reload_btn.className = 'css_button'; reload_btn.innerHTML = '🔄 Seite jetzt neu laden';
                        Object.assign( reload_btn.style, { marginTop: '8px', padding: '8px 16px', cursor: 'pointer', backgroundColor: '#ff9900', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '13px' } );
                        reload_btn.onclick = () => location.reload();
                        results_area.appendChild( reload_btn );
                        btn_check.style.display = 'block'; btn_check.disabled = false;
                        return;
                    }

                    throw new Error( 'Der Worker konnte nicht gestartet werden.' );
                }

                let elapsed_seconds = 0; 
                const TIMEOUT_MAX = 900; // 15 Minuten
                
                set_status('⏳', `Artikel wird verarbeitet... (0 Sekunden)`, `Geschätzte Dauer: ca. 2 - 3 Minuten`, '#f1fa8c', true);
                const start_time = Date.now();

                let cached_poll_response = null;
                let last_poll_time = 0;
                let next_poll_time = Date.now() + 30000; // first poll after 30s grace
                manual_poll_area = null;  // persistent container below status
                let poll_result_el = null;    // shows last poll result (highlighted)

                // Promise-based sleep that can be resolved early via wakeup().
                // Overcomes browser throttling of setTimeout in background tabs.
                let wakeup_resolve = null;
                function wakeup() { if (wakeup_resolve) { wakeup_resolve(); wakeup_resolve = null; } }
                function interruptible_sleep(ms) {
                    return new Promise(resolve => {
                        wakeup_resolve = resolve;
                        setTimeout(resolve, ms);
                    });
                }

                // Manual server poll: fetches status, caches result, and wakes poll_loop
                async function do_manual_poll(label) {
                    log_debug(`${label}: Server-Abfrage...`);
                    last_poll_time = Date.now();
                    try {
                        const poll_res = await fetch(`${POLLER_URL}?jobId=${encodeURIComponent(job_id)}`, {
                            method: 'GET', headers: { 'x-api-key': POLLER_API_KEY }
                        });
                        if (poll_res.ok) {
                            const data = await poll_res.json();
                            const job_status = data.status || 'pending';
                            log_debug(`${label}: Status = ${job_status}`);
                            if (job_status !== 'pending') {
                                cached_poll_response = data;
                            }
                            // Visuelles Feedback im Countdown-Bereich
                            if (countdown_el) {
                                countdown_el.textContent = job_status === 'pending' ? 'Abfrage erfolgreich — wird noch verarbeitet...' : 'Abfrage erfolgreich — Ergebnis wird geladen...';
                                countdown_el.style.color = '#50fa7b';
                                setTimeout(() => { if (countdown_el) countdown_el.style.color = '#6272a4'; }, 2000);
                            }
                        }
                    } catch(e) { log_debug(`${label}: Fehlgeschlagen (${e.message})`); }
                    wakeup(); // poll_loop sofort aufwecken
                }

                // Tab return handler: fires reliably when user switches back to this tab
                let tab_return_until = 0; // boost: fast polling until this timestamp
                function on_visibility_change() {
                    if (document.visibilityState !== 'visible' || !poll_active) return;
                    elapsed_seconds = Math.round((Date.now() - start_time) / 1000);
                    if (elapsed_seconds < 30) return;
                    if (Date.now() - last_poll_time < 5000) { log_debug('Tab sichtbar, aber letzter Abruf <5s her. Übersprungen.'); return; }
                    tab_return_until = Date.now() + 60000; // 60s schnelles Polling nach Tab-Rückkehr
                    next_poll_time = Date.now(); // poll_loop soll nach Aufwachen sofort abfragen
                    if (countdown_el) { countdown_el.textContent = 'Abfrage läuft...'; countdown_el.style.color = '#f1fa8c'; }
                    do_manual_poll('Tab-Rückkehr');
                }
                document.addEventListener('visibilitychange', on_visibility_change);

                // Build persistent poll info area (below status, never destroyed by set_status)
                manual_poll_area = document.createElement('div');
                manual_poll_area.style.cssText = 'margin-top: 2px; margin-left: 28px; font-size: 12px; color: #aaa; display: none;';

                // Countdown line: "Nächste Abfrage in 12s"
                const countdown_el = document.createElement('div');
                countdown_el.style.cssText = 'color: #6272a4; margin-bottom: 4px;';
                manual_poll_area.appendChild(countdown_el);

                // Last poll result (highlighted)
                poll_result_el = document.createElement('div');
                poll_result_el.style.cssText = 'display: none; margin-bottom: 6px; padding: 4px 8px; border-radius: 4px; font-weight: bold;';
                manual_poll_area.appendChild(poll_result_el);

                // Insert right after status_el so set_status() never destroys it
                status_el.after(manual_poll_area);

                timer_interval = setInterval(() => {
                    if (!poll_active) return;
                    elapsed_seconds = Math.round((Date.now() - start_time) / 1000);
                    const time_str = format_duration_friendly(elapsed_seconds);
                    set_status('⏳', `Artikel wird verarbeitet... (${time_str})`, `Geschätzte Dauer: ca. 2 - 3 Minuten`, '#f1fa8c', false);

                    // Show poll area after 30s (countdown visible), manual button after 2 min
                    if (elapsed_seconds >= 30) {
                        manual_poll_area.style.display = 'block';
                        // Countdown to next automatic poll
                        const secs_to_next = Math.max(0, Math.round((next_poll_time - Date.now()) / 1000));
                        countdown_el.textContent = secs_to_next > 0
                            ? `Nächste automatische Abfrage in ${secs_to_next}s`
                            : 'Abfrage läuft...';
                    }
                    if (elapsed_seconds >= TIMEOUT_MAX) {
                        // Prevent multiple timeout handlers from firing
                        clearInterval(timer_interval);
                        (async () => {
                            await do_manual_poll('Timeout-Abfrage');
                            if (cached_poll_response) {
                                // Result arrived — poll_loop will process it (wakeup already called)
                                return;
                            }
                            // Truly no result — give up
                            poll_active = false; unlock_editor();
                            document.removeEventListener('visibilitychange', on_visibility_change);
                            wakeup(); // unblock poll_loop so it exits
                            launcher_tab.querySelector('span').innerText = '🤖 KI-Korrektor';
                            set_status('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                            manual_poll_area.style.display = 'none';
                            add_message(`Das Polling wurde nach ${format_duration_friendly(TIMEOUT_MAX)} abgebrochen.`, 'error');
                            btn_check.style.display = 'block'; btn_check.disabled = false;
                        })();
                    }
                }, 1000);
                
                // Main polling loop (async IIFE, runs alongside the 1s timer)
                // Adaptive intervals: 30s initial wait → 15s (30-90s) → 2s (90-300s) → 30s (300s+)
                (async function poll_loop() {
                    try {
                        // Initial grace period — backend needs time to start processing
                        if (poll_active) await interruptible_sleep(30000);

                        // Loop exits when poll_active=false AND no cached result pending.
                        // TIMEOUT_MAX is enforced by the timer_interval handler, not here.
                        while (poll_active || cached_poll_response) {
                            let current_elapsed = Math.round((Date.now() - start_time) / 1000);

                            // Use cached response from tab-return or manual poll if available
                            let data;
                            if (cached_poll_response) {
                                log_debug('Verwende gecachte Antwort von Tab-Rückkehr.');
                                data = cached_poll_response;
                                cached_poll_response = null;
                            } else {
                                log_debug(`Frage Status ab...`);
                                last_poll_time = Date.now();
                                try {
                                    const poll_res = await fetch(`${POLLER_URL}?jobId=${encodeURIComponent(job_id)}`, {
                                        method: 'GET', headers: { 'x-api-key': POLLER_API_KEY }
                                    });
                                    if (!poll_res.ok) { next_poll_time = Date.now() + 3000; await interruptible_sleep(3000); continue; }
                                    data = await poll_res.json();
                                } catch(e) { log_debug(`Poll-Fehler: ${e.message}`); next_poll_time = Date.now() + 3000; await interruptible_sleep(3000); continue; }
                            }
                            const job_status = data.status || 'pending';

                            if (job_status === 'pending') {
                                if (!poll_active) break; // timeout handler killed the loop
                                // Adaptive wait: slow at start, fast mid-range, slow after 5 min
                                // Nach Tab-Rückkehr: 4s Intervall für 60 Sekunden
                                const in_tab_boost = Date.now() < tab_return_until;
                                const wait_sec = in_tab_boost ? 4 : current_elapsed < 90 ? 15 : current_elapsed < 300 ? 3 : 30;
                                next_poll_time = Date.now() + wait_sec * 1000;
                                await interruptible_sleep(wait_sec * 1000);
                                continue;
                            }

                            poll_active = false; cached_poll_response = null; clearInterval(timer_interval); unlock_editor();
                            document.removeEventListener('visibilitychange', on_visibility_change);
                            manual_poll_area.style.display = 'none';
                            const final_duration_str = format_duration_friendly(Math.round((Date.now() - start_time) / 1000));
                            log_debug(`Job abgeschlossen: ${job_status}.`);

                            if (job_status === 'error') {
                                const err_msg = data.fixes || data.error || 'Unbekannter Fehler im KI-Agenten.';
                                log_debug(`Fehlerdetails vom Server: ${err_msg}`);

                                launcher_tab.querySelector('span').innerText = '❌ KI-Fehler';
                                set_status('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                                add_message('<b>Fehlerdetails:</b> Bei der Verarbeitung ist ein Fehler aufgetreten. Details im Debug-Log.', 'error');
                                btn_check.style.display = 'block'; btn_check.disabled = false;
                                return;
                            }

                            // --- SUCCESS: Parse response, update editor, render results ---
                            if (job_status === 'success') {
                                launcher_tab.querySelector('span').innerText = '✅ KI Fertig';
                                let new_content = data.content || null;
                                const fixes_text = data.fixes || '';
                                
                                const korrektor_match = fixes_text.match(/<korrektor>([\s\S]*?)<\/korrektor>/i);
                                const verlinker_match = fixes_text.match(/<verlinker>([\s\S]*?)<\/verlinker>/i);
                                let korrektor_text = korrektor_match ? korrektor_match[1].trim() : null;
                                const verlinker_text = verlinker_match ? verlinker_match[1].trim() : null;

                                if (korrektor_text) korrektor_text = korrektor_text.replace(/\. (Rechtschreibung|Grammatik|Die Rechtschreibung|Zur Rechtschreibung|Es wurden keine signifikanten)/gi, '.\n$1').replace(/\. (Die Shortcode|Shortcodes)/gi, '.\n$1');
                                if (!new_content) throw new Error('Erfolg gemeldet, aber kein Text gespeichert.');

                                new_content = clean_ai_content( new_content );
                                set_status( '⏳', 'Schreibe Korrekturen in Editor...', null, '#8be9fd' );

                                // Write corrected content back to the content field
                                if( !write_field_value( content_info.config.fields.content, new_content ) ) {
                                    throw new Error( 'Editor zum Zurückschreiben wurde nicht gefunden.' );
                                }

                                // Write corrected headline back if provided
                                if( data.headline && content_info.config.fields.headline ) {
                                    write_field_value( content_info.config.fields.headline, data.headline );
                                }

                                // Write corrected teaser back if provided
                                if( data.teaser && content_info.config.fields.teaser ) {
                                    write_field_value( content_info.config.fields.teaser, data.teaser );
                                }

                                set_status('✅', `Erfolgreich aktualisiert! (Dauer: ${final_duration_str})`, null, '#50fa7b');
                                btn_diff.style.display = 'flex'; btn_undo.style.display = 'flex'; btn_close_bottom.style.display = 'flex';

                                if (korrektor_text) {
                                    const korr_box = document.createElement('div'); Object.assign(korr_box.style, { backgroundColor: '#2d2d30', padding: '12px', borderRadius: '6px', border: '1px solid #3a3a3c' });
                                    const k_title = document.createElement('div'); k_title.innerHTML = '<span style="color:#8be9fd; font-weight:bold; font-size:14px;">📝 Text- & Shortcode-Korrekturen</span><hr style="border:0; border-top:1px solid #444; margin:8px 0;">';
                                    korr_box.appendChild(k_title);
                                    const lines = korrektor_text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                                    lines.forEach(line => {
                                        let clean_line = line.replace(/^[-*•#\d.]+\s*/, '');
                                        const safe_line = escape_html(clean_line);
                                        const div = document.createElement('div');
                                        if(clean_line.toLowerCase().includes('keine korrek') || clean_line.toLowerCase().includes('nicht')) {
                                            div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${safe_line}</span>`; div.style.marginTop = '6px';
                                        } else {
                                            div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${safe_line}</span>`; div.style.marginTop = '6px'; div.style.paddingLeft = '5px';
                                        }
                                        korr_box.appendChild(div);
                                    });
                                    results_area.appendChild(korr_box);
                                }

                                {
                                    const verl_box = document.createElement('div'); Object.assign(verl_box.style, { backgroundColor: '#2d2d30', padding: '12px', borderRadius: '6px', border: '1px solid #3a3a3c' });
                                    const lines = verlinker_text ? verlinker_text.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
                                    const link_count = lines.filter(l => l.toLowerCase().startsWith('link')).length;
                                    const v_title = document.createElement('div'); v_title.innerHTML = `<span style="color:#50fa7b; font-weight:bold; font-size:14px;">🔗 ${link_count === 1 ? 'Verlinkung' : 'Verlinkungen'}</span><hr style="border:0; border-top:1px solid #444; margin:8px 0;">`;
                                    verl_box.appendChild(v_title);
                                    if (lines.length === 0) {
                                        const no_links = document.createElement('div'); Object.assign(no_links.style, { borderLeft: '3px solid #ffb86c', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                        no_links.innerHTML = '<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">Keine passenden Verlinkungen gefunden.</span>';
                                        verl_box.appendChild(no_links);
                                    }
                                    let current_group = null;
                                    lines.forEach(line => {
                                        let clean_line = line.replace(/^[-*•#\d.]+\s*/, '');
                                        const line_lower = clean_line.toLowerCase();
                                        const safe_line = escape_html(clean_line).replace(/(https?:\/\/[^\s&<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #66d9ef; text-decoration: underline;">$1</a>');
                                        if (line_lower.startsWith('link')) {
                                            // URL und Linktext aus der Zeile extrahieren
                                            const url_match = clean_line.match(/(https?:\/\/[^\s]+)/);
                                            const link_text_match = clean_line.match(/[""„]([^""„"]+)[""„"]/);
                                            const link_url = url_match ? url_match[1] : null;
                                            const link_text = link_text_match ? link_text_match[1] : null;

                                            // Content-Type-Tag anhand URL-Muster
                                            let url_type_tag = '';
                                            if (link_url) {
                                                const u = link_url.toLowerCase();
                                                const tag = u.includes('/news,') || u.includes('/news/') ? { label: 'News', bg: '#007acc' }
                                                    : u.includes('/download') ? { label: 'Download', bg: '#8b5cf6' }
                                                    : u.includes('/videos,') || u.includes('/video/') || u.includes('/videos/') ? { label: 'Video', bg: '#e74c3c' }
                                                    : u.includes('/faq/') || u.includes('/faq,') ? { label: 'FAQ', bg: '#f59e0b' }
                                                    : u.includes('/special/') ? { label: 'Special', bg: '#10b981' }
                                                    : u.includes('/tests,') || u.includes('/tests/') || u.includes('/test/') ? { label: 'Test', bg: '#ec4899' }
                                                    : null;
                                                if (tag) url_type_tag = `<span style="display:inline-block; background:${tag.bg}; color:#fff; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:3px; margin-right:5px; vertical-align:middle; letter-spacing:0.3px;">${tag.label}</span>`;
                                            }

                                            current_group = document.createElement('div'); Object.assign(current_group.style, { borderLeft: '3px solid #007acc', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0', position: 'relative', transition: 'opacity 0.3s, max-height 0.3s, margin 0.3s, padding 0.3s', overflow: 'hidden' });
                                            if (link_url) current_group.dataset.previewUrl = link_url;
                                            const safe_line_with_tag = safe_line.replace(/(https?:\/\/[^\s&<]+)/, url_type_tag + '$1');
                                            current_group.innerHTML = `<div>► <span style="color:#f8f8f2; font-weight:bold;">${safe_line_with_tag}</span></div>`;

                                            // X-Button zum Entfernen des Links
                                            if (link_url) {
                                                const remove_btn = document.createElement('span');
                                                remove_btn.innerHTML = '✕';
                                                Object.assign(remove_btn.style, { position: 'absolute', top: '6px', right: '8px', cursor: 'pointer', backgroundColor: '#cc3333', color: '#fff', fontSize: '12px', fontWeight: 'bold', lineHeight: '1', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', transition: 'background-color 0.2s' });
                                                remove_btn.title = 'Link entfernen';
                                                remove_btn.onmouseover = () => remove_btn.style.backgroundColor = '#ff4444'; remove_btn.onmouseout = () => remove_btn.style.backgroundColor = '#cc3333';
                                                const group_ref = current_group;
                                                remove_btn.onclick = () => {
                                                    // Link aus allen Editor-Feldern entfernen (Linktext behalten)
                                                    const escaped_url = link_url.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
                                                    const link_regex = new RegExp( `<a\\s[^>]*href=["']${escaped_url}["'][^>]*>(.*?)<\\/a>`, 'gi' );
                                                    let removed = false;

                                                    if( content_info ) {
                                                        for( const key in content_info.config.fields ) {
                                                            const field_val = read_field_value( content_info.config.fields[key] );
                                                            const cleaned = field_val.replace( link_regex, '$1' );

                                                            if( cleaned !== field_val ) {
                                                                write_field_value( content_info.config.fields[key], cleaned );
                                                                cached_diff[key] = null;
                                                                removed = true;
                                                                log_debug( `Link entfernt aus ${key}: ${link_url}` );
                                                            }
                                                        }
                                                    }

                                                    if( !removed ) log_debug( `Link nicht im Text gefunden: ${link_url}` );
                                                    // Box ausblenden mit Animation
                                                    group_ref.style.maxHeight = group_ref.scrollHeight + 'px';
                                                    requestAnimationFrame(() => { group_ref.style.opacity = '0'; group_ref.style.maxHeight = '0'; group_ref.style.margin = '0'; group_ref.style.padding = '0'; });
                                                    setTimeout(() => group_ref.remove(), 350);
                                                };
                                                current_group.appendChild(remove_btn);
                                            }

                                            verl_box.appendChild(current_group);
                                        } else if (line_lower.startsWith('begründung') && current_group) {
                                            const reason_div = document.createElement('div'); reason_div.innerHTML = `<span style="color:#cccccc;">${safe_line}</span>`; reason_div.style.marginTop = '6px';
                                            current_group.appendChild(reason_div);
                                        } else {
                                            current_group = null;
                                            const div = document.createElement('div'); Object.assign(div.style, { marginTop: '6px', paddingLeft: '5px' });
                                            if(line_lower.includes('keine') || line_lower.includes('nicht') || line_lower.includes('wurden')) {
                                                Object.assign(div.style, { borderLeft: '3px solid #ffb86c', backgroundColor: '#1e1e1e', padding: '10px 12px', margin: '8px 0', borderRadius: '0 4px 4px 0' });
                                                div.innerHTML = `<span style="color:#ffb86c;">►</span> <span style="color:#f8f8f2;">${safe_line}</span>`;
                                            } else {
                                                div.innerHTML = `<span style="color:#6272a4;">►</span> <span style="color:#f8f8f2;">${safe_line}</span>`;
                                            }
                                            verl_box.appendChild(div);
                                        }
                                    });
                                    results_area.appendChild(verl_box);

                                    // --- Link-Vorschau via wfv4_link_preview ---
                                    wfv4_link_preview.attach(verl_box, '[data-preview-url]', el => el.dataset.previewUrl);
                                }

                                // Auto-resize terminal height to fit content (up to viewport - 40px)
                                requestAnimationFrame(() => {
                                    const header_h = header.offsetHeight;
                                    const footer_h = footer.offsetHeight;
                                    const content_h = content_area.scrollHeight;
                                    const needed = header_h + content_h + footer_h + 2;
                                    const max_h = window.innerHeight - 40;
                                    terminal_container.style.height = Math.min(needed, max_h) + 'px';
                                });
                            }
                        }
                    } catch (poll_err) {
                        if (poll_active) {
                            poll_active = false; clearInterval(timer_interval); unlock_editor();
                            document.removeEventListener('visibilitychange', on_visibility_change);
                            if (manual_poll_area) manual_poll_area.style.display = 'none';
                            log_debug(`Polling-Fehler: ${poll_err.message}`);
                            launcher_tab.querySelector('span').innerText = '🤖 KI-Korrektor';
                            btn_check.style.display = 'block'; btn_check.disabled = false;
                            set_status('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                            add_message('Bei der Statusabfrage ist ein Fehler aufgetreten. Details im Debug-Log.', 'error');
                        }
                    }
                })();
            } catch (error) {
                poll_active = false; clearInterval(timer_interval); unlock_editor();
                if (typeof on_visibility_change === 'function') document.removeEventListener('visibilitychange', on_visibility_change);
                if (manual_poll_area) manual_poll_area.style.display = 'none';
                log_debug(`Allgemeiner Fehler: ${error.message}`);
                launcher_tab.querySelector('span').innerText = '🤖 KI-Korrektor';
                btn_check.style.display = 'block'; btn_check.disabled = false;
                set_status('❌', 'Leider ist ein Fehler aufgetreten.', 'Bitte versuchen Sie es erneut.', '#ff5555', true);
                add_message('Ein unerwarteter Fehler ist aufgetreten. Details im Debug-Log.', 'error');
            }
        });
    }

    // Start immediately if DOM is ready, otherwise wait for DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init_widget);
    } else {
        init_widget();
    }

})();