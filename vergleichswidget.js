/*
 * VergleichsWidget — Vorher/Nachher Diff-Widget mit Absatz-Alignment
 * ─────────────────────────────────────────────────────────────────────
 *
 * Zweck
 *   Redaktioneller Side-by-Side-Vergleich von zwei Text-Versionen eines
 *   WinFuture-Artikels (Überschrift, Teaser, Body). Der Redakteur geht
 *   die Änderungen Absatz für Absatz durch, akzeptiert oder verwirft
 *   sie, darf den Nachher-Text inline noch nachjustieren und bekommt
 *   am Ende einen byte-exakten Bundle-String zurück.
 *
 * Garantierte Invariante
 *   ──────────────────────
 *   Der Widget VERÄNDERT NIE den Artikelinhalt. Was an `before`/`after`
 *   übergeben wurde, kommt — abhängig von der Entscheidung pro Absatz —
 *   byte-für-byte über `onResolve` zurück. Alle Sanitisierungen wirken
 *   ausschließlich auf die Anzeige (HTML, das im Modal gerendert wird),
 *   nicht auf das was zurückgegeben wird. Editorial-Content darf alles
 *   enthalten — <script>, onclick, javascript:-URLs, <form>, <input>,
 *   <button>, ##-Codes — und kommt unverändert wieder raus.
 *
 * Architektur
 *   1. Drei separate Paragraph-LCS-Diffs (Headline / Teaser / Content).
 *   2. Within-Paragraph-Token-Diff für Mod-Zeilen → durchgehende
 *      Inline-Highlights über Whitespace hinweg.
 *   3. 3-Spalten-Grid (Vorher | Nachher | × ✓-Buttons).
 *      Beide Cells sind read-only — Bearbeiten erfolgt nach dem
 *      Resolve direkt im Ziel-Editor.
 *   4. Zwei Anzeige-Modi:
 *        - 'pseudo' (Default): Plain-Text-Lesemodus, Monospace, alles
 *          außer Links versteckt, ##-Codes außer ##a## entfernt.
 *        - 'editor': HTML-Code-Ansicht, syntax-gehighlightet.
 *   5. Tastatur: ↑/↓ navigiert, → annehmen, ← ablehnen, Esc schließen.
 *
 * Public API
 *   ────────
 *   VergleichsWidget.open({
 *     before: {
 *       headline: '...',         // optional — Sektion wird weggelassen, wenn leer
 *       teaser:   '...',         // optional
 *       content:  '<h2>…</h2>…'  // Body inkl. HTML & ##-Codes
 *     },
 *     after: { headline, teaser, content },
 *     title:        'Unterschiede',                // optional
 *     defaultMode:  'pseudo' | 'editor',           // optional, Default 'pseudo'
 *     defaultOnlyChanges: true | false,            // optional, Default true
 *     onResolve:    (resolved, stats) => { … },
 *     // resolved = { headline, teaser, content }  — byte-exakt
 *     // stats    = { total, accepted, rejected }
 *     onClose:      () => { … }
 *   });
 *
 *   Backwards-compat: `before` / `after` dürfen auch reine Strings sein.
 *   Dann wird der String als `content` behandelt und `onResolve` bekommt
 *   einen einzelnen String zurück statt eines Bundles.
 *
 * Lizenz / Eigentum
 *   Interne WinFuture-Komponente. Keine externen Dependencies, kein
 *   Build-Schritt. Direkt per <script src="vergleichswidget.js">
 *   einbindbar.
 *
 * Siehe auch CLAUDE.md im selben Ordner — verdichtetes Onboarding-Doku
 * für künftige Bearbeitung.
 */
( function( global ) {
	'use strict';

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   1. CSS
	// ────────────────────────────────────────────────────────────────────────────
	//

	var CSS = ''
		+ '.vw-overlay,.vw-overlay *{box-sizing:border-box;text-transform:none;letter-spacing:normal;font-style:normal;text-align:left;}'
		+ '.vw-overlay button,.vw-overlay input,.vw-overlay label{font-weight:400;}'
		+ '.vw-overlay{position:fixed;inset:0;background:rgba(20,22,28,.55);z-index:2147483600;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2328;}'
		// Höhe orientiert sich am Inhalt — bei kurzen Texten wird das Modal
		// kompakt, bei längeren wächst es bis max 94vh und der Body scrollt.
		+ '.vw-modal{background:#fff;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.35);width:min(1280px,96vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;}'
		+ '.vw-body{min-height:0;}'
		+ '.vw-header{display:flex;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#f8f9fb;flex-shrink:0;}'
		+ '.vw-title{font-size:15px;font-weight:600;letter-spacing:.2px;}'
		+ '.vw-checkbox{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none;}'
		+ '.vw-checkbox input{accent-color:#1f2328;}'
		+ '.vw-grow{flex:1 1 auto;}'
		+ '.vw-nav{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#3a3f46;}'
		+ '.vw-icon-btn{appearance:none;border:1px solid #d0d4dc;background:#fff;width:28px;height:26px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:#3a3f46;}'
		+ '.vw-icon-btn:hover{background:#f1f3f6;}'
		+ '.vw-icon-btn:disabled{opacity:.4;cursor:not-allowed;}'
		+ '.vw-counter{min-width:42px;text-align:center;font-variant-numeric:tabular-nums;}'
		+ '.vw-search{display:inline-flex;align-items:center;gap:6px;border:1px solid #d0d4dc;background:#fff;border-radius:6px;padding:4px 10px;}'
		+ '.vw-search svg{opacity:.55;}'
		+ '.vw-search input{appearance:none;border:0;outline:none;font:inherit;font-size:13px;width:160px;background:transparent;color:inherit;}'
		+ '.vw-close{appearance:none;border:1px solid #d0d4dc;background:#fff;border-radius:6px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:inherit;}'
		+ '.vw-close:hover{background:#f1f3f6;}'

		// Body is a 3-column grid: Vorher | Nachher | Buttons.
		// Each row in the grid corresponds to one paragraph (or one paragraph
		// boundary in the merged sequence). Same row = same vertical slot in
		// both panes, so the editor can compare paragraph-by-paragraph.
		+ '.vw-body{flex:1 1 auto;overflow:auto;background:#fff;}'
		+ '.vw-grid{display:grid;grid-template-columns:1fr 1fr 60px;column-gap:0;align-items:stretch;}'
		+ '.vw-cell{padding:14px 18px;border-bottom:1px solid #eef0f3;line-height:1.55;color:#1f2328;background:#fff;overflow-wrap:anywhere;}'

		// Quelltext-Modus: monospace, Whitespace-erhaltend, alles roh (HTML-Tags
		// und ##-Codes werden als Text angezeigt). Default.
		+ '.vw-mode-editor .vw-cell{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:13px;white-space:pre-wrap;tab-size:4;}'
		// Lesbar-Modus: Monospace (gleich wie Quelltext) aber mit normalem
		// Wrapping. HTML-Tags & ##-Codes (außer ##a) sind hier unsichtbar,
		// damit der Redakteur sich nur auf den Text und die Diffs konzentriert.
		+ '.vw-mode-pseudo .vw-cell{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:13px;white-space:pre-wrap;tab-size:4;font-weight:400;}'
		+ '.vw-cell-before{border-right:1px solid #e5e7eb;}'
		+ '.vw-cell-after{border-right:1px solid #e5e7eb;}'
		+ '.vw-cell-actions{display:flex;align-items:flex-start;justify-content:center;padding:14px 4px;gap:2px;background:#fafbfc;border-bottom:1px solid #eef0f3;}'

		// Important: row-state classes (vw-row-mod, vw-row-add, vw-row-active,
		// vw-row-resolved, vw-row-rejected) are applied DIRECTLY to each cell
		// (vw-cell-before / vw-cell-after / vw-cell-actions) because all three
		// cells of a logical row are siblings in the same grid — no shared
		// wrapper. Hence the compound selectors below (".vw-cell-before.vw-row-mod"
		// instead of ".vw-row-mod .vw-cell-before").
		+ '.vw-cell-before.vw-row-mod,.vw-cell-after.vw-row-mod{background:#fffdf6;}'
		+ '.vw-cell-after.vw-row-add{background:#f1faf1;}'
		+ '.vw-cell-before.vw-row-del{background:#fef1f1;}'
		+ '.vw-cell-before.vw-row-add,.vw-cell-after.vw-row-del{background:#fafbfc;color:#94979d;font-style:italic;font-size:12px;}'

		// Status-Akzent in der MITTE zwischen Vorher und Nachher
		// (rechter Rand der Vorher-Zelle = linker Rand der Nachher-Zelle).
		+ '.vw-cell-before{position:relative;}'
		+ '.vw-cell-after{position:relative;}'

		// Aktive Zeile (per Tastatur fokussiert): gelber Akzent in der Mitte.
		+ '.vw-cell-before.vw-row-active{box-shadow:inset -3px 0 0 0 #f5b942;}'
		+ '.vw-cell-after.vw-row-active{box-shadow:inset 3px 0 0 0 #f5b942;}'

		// Entscheidung wird nur über die farbige Mittellinie + Opacity der
		// abgewählten Seite kommuniziert. Keine Pfeil-Bubbles, keine Labels —
		// das wäre Doppelung.
		// Zugestimmt: grüne Mittellinie + Vorher ausgegraut.
		+ '.vw-cell-before.vw-row-resolved{box-shadow:inset -3px 0 0 0 #2da44e;opacity:.4;}'
		+ '.vw-cell-after.vw-row-resolved{box-shadow:inset 3px 0 0 0 #2da44e;}'
		// Abgelehnt: rote Mittellinie + Nachher ausgegraut.
		+ '.vw-cell-before.vw-row-rejected{box-shadow:inset -3px 0 0 0 #cf222e;}'
		+ '.vw-cell-after.vw-row-rejected{box-shadow:inset 3px 0 0 0 #cf222e;opacity:.4;}'

		// Lesbar-Modus: Links bleiben erkennbar, strong/em werden flach,
		// Listen rendern inline. Überschriften (h1-6) bekommen Fett-Render
		// als eigene Zeile innerhalb des Absatzes — sie sollen als
		// Zwischenüberschrift wirken, ohne eine eigene Zeile in der
		// Vergleichs-Tabelle zu erzeugen (sie sind via split_paragraphs in
		// den folgenden Absatz gemergt).
		// Links sind im Lesbar-Modus bewusst gedämpft: dunkles Schiefergrau-
		// blau mit halbtransparenter Unterstreichung. So bleibt klar, dass es
		// Links sind, aber die Farbe konkurriert nicht mit den eigentlichen
		// Diff-Markierungen (rot/grün).
		+ '.vw-mode-pseudo .vw-cell a{color:#475569;text-decoration:underline;text-decoration-color:rgba(71,85,105,.45);}'
		// Headings: nur fett, kein Abstand zum folgenden Text (wie im HTML-
		// Quelltext steht auch dort kein Leerzeichen dazwischen).
		+ '.vw-mode-pseudo .vw-cell h1,.vw-mode-pseudo .vw-cell h2,.vw-mode-pseudo .vw-cell h3,.vw-mode-pseudo .vw-cell h4,.vw-mode-pseudo .vw-cell h5,.vw-mode-pseudo .vw-cell h6{font-weight:700;font-size:inherit;display:block;margin:0;}'
		// Inline-Auszeichner im Lesbar-Modus: <b>/<strong> bleiben fett,
		// damit der Redakteur Zwischen-Überschriften wie „Siehe auch:" oder
		// fett ausgezeichnete Header sofort erkennt. <em>/<i>/<u> werden
		// neutralisiert — sie sind im Diff-Kontext meist nur visuelles
		// Rauschen, das von den eigentlichen Text-Änderungen ablenkt.
		+ '.vw-mode-pseudo .vw-cell strong,.vw-mode-pseudo .vw-cell b{font-weight:700;font-style:normal;font-size:inherit;margin:0;padding:0;display:inline;}'
		+ '.vw-mode-pseudo .vw-cell em,.vw-mode-pseudo .vw-cell i,.vw-mode-pseudo .vw-cell u{font-weight:400;font-style:normal;font-size:inherit;text-decoration:inherit;margin:0;padding:0;display:inline;}'
		+ '.vw-mode-pseudo .vw-cell p{margin:0;display:inline;}'
		+ '.vw-mode-pseudo .vw-cell ul,.vw-mode-pseudo .vw-cell ol{margin:0;padding:0;list-style:none;display:inline;}'
		+ '.vw-mode-pseudo .vw-cell li{display:inline;}'

		// Überschrift- und Teaser-Sektion: erste zwei Zeilen sind visuell
		// hervorgehoben. Cells sind Sibling-Grid-Items (kein Wrapper), darum
		// die compound-Selektoren.
		+ '.vw-cell-before.vw-row-headline,.vw-cell-after.vw-row-headline{background:#fbf7e8;font-weight:700;font-size:15px;line-height:1.4;}'
		// Teaser: gleich fett wie die Headline, aber bläulicher Hintergrund
		// als visueller Unterschied. Vorher: kursiv — Nutzer wollte fett.
		+ '.vw-cell-before.vw-row-teaser,.vw-cell-after.vw-row-teaser{background:#f3f6fb;font-weight:700;color:#1f2328;}'
		+ '.vw-mode-pseudo .vw-cell-before.vw-row-headline,.vw-mode-pseudo .vw-cell-after.vw-row-headline{font-size:16px;}'
		// Keine Section-Labels mehr — der Hintergrund (gelblich für Headline,
		// bläulich für Teaser) ist Hervorhebung genug. Eine zusätzliche
		// "Über-Überschrift" wäre Doppelung.

		// Mode toggle (segmented buttons im Header)
		+ '.vw-segmented{display:inline-flex;border:1px solid #d0d4dc;border-radius:6px;overflow:hidden;background:#fff;}'
		+ '.vw-segmented button{appearance:none;border:0;background:transparent;font:inherit;font-size:13px;padding:6px 12px;cursor:pointer;color:#3a3f46;}'
		+ '.vw-segmented button.vw-active{background:#1f2328;color:#fff;font-weight:500;}'

		+ '.vw-del{background:#ffe1e1;border-radius:3px;padding:0 2px;}'
		+ '.vw-del:not(:has(.vw-syn)){color:#a30015;text-decoration:line-through;text-decoration-color:rgba(163,0,21,.55);}'
		+ '.vw-ins{background:#d6f0d6;border-radius:3px;padding:0 2px;}'
		+ '.vw-ins:not(:has(.vw-syn)){color:#176c1f;}'
		// Im Lesbar-Modus wird ein <a>-Tag aus dem Markup gelöscht — die
		// Tag-Klammer selbst ist unsichtbar, weil sie als Link gerendert wird.
		// Damit der Redakteur trotzdem sieht "hier wurde ein Link hinzugefügt
		// bzw. entfernt", markieren wir das <a>-Element mit einem dezenten
		// farbigen Hintergrund: grün bei eingefügtem Link, rot bei entferntem.
		+ '.vw-mode-pseudo a.vw-link-ins{background:#d6f0d6;border-radius:3px;padding:0 2px;text-decoration-color:#176c1f;}'
		+ '.vw-mode-pseudo a.vw-link-del{background:#ffe1e1;border-radius:3px;padding:0 2px;text-decoration-color:#a30015;}'

		// Editor-Syntax-Highlighting (nur HTML+Shortcodes-Modus). WICHTIG:
		// kein Rot — Rot ist für Diff-Löschungen reserviert. Stattdessen:
		// Tags blau, Attribute braun-orange, Strings teal, URLs blau,
		// Shortcodes indigo. So bleibt der Diff-Farbcode (rot=raus, grün=rein)
		// eindeutig.
		+ '.vw-mode-editor .vw-syn-tag-bracket{color:#5c6975;}'
		+ '.vw-mode-editor .vw-syn-tag-name{color:#0550ae;font-weight:600;}'
		+ '.vw-mode-editor .vw-syn-attr{color:#b45309;}'
		+ '.vw-mode-editor .vw-syn-string{color:#0e7490;}'
		+ '.vw-mode-editor .vw-syn-url{color:#2563eb;text-decoration:underline;}'
		+ '.vw-mode-editor .vw-syn-equals{color:#6b7280;}'
		+ '.vw-mode-editor .vw-syn-sc-mark{color:#6b7280;font-weight:600;}'
		+ '.vw-mode-editor .vw-syn-sc-name{color:#4338ca;font-weight:600;}'
		+ '.vw-mode-editor .vw-cell{color:#1f2328;}'

		+ '.vw-actions-btn{appearance:none;border:1px solid #d0d4dc;background:#fff;width:24px;height:24px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;color:#3a3f46;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}'
		+ '.vw-actions-btn:hover{background:#f1f3f6;}'
		+ '.vw-actions-btn.vw-accept{color:#176c1f;}'
		+ '.vw-actions-btn.vw-reject{color:#a30015;}'
		+ '.vw-actions-btn.vw-on-accept{background:#176c1f;color:#fff;border-color:#176c1f;}'
		+ '.vw-actions-btn.vw-on-reject{background:#a30015;color:#fff;border-color:#a30015;}'
		+ '.vw-row-eq .vw-cell-actions{visibility:hidden;}'

		+ '.vw-empty{color:#94979d;font-style:italic;font-size:12px;}'

		+ '.vw-search-hit{outline:2px solid #f5b942;outline-offset:1px;border-radius:3px;background:#fff5d8;}'

		+ '.vw-footer{display:flex;align-items:center;gap:14px;padding:8px 14px;border-top:1px solid #e5e7eb;background:#f8f9fb;flex-shrink:0;font-size:12px;color:#3a3f46;}'
		+ '.vw-legend{display:inline-flex;align-items:center;gap:6px;}'
		+ '.vw-legend-label{color:#94979d;font-size:11px;font-weight:500;letter-spacing:.5px;text-transform:uppercase;margin-right:2px;}'
		// Legenden-Tags benutzen denselben Hintergrund wie die Diff-Highlights
		// im Body — damit der Redakteur sofort erkennt: das sind Beispiele
		// für die Markierungen im Diff darüber.
		+ '.vw-legend-tag{padding:1px 8px;border-radius:3px;font-weight:600;font-size:11px;}'
		+ '.vw-legend-tag.vw-del{background:#ffe1e1;color:#a30015;text-decoration:none;}'
		+ '.vw-legend-tag.vw-ins{background:#d6f0d6;color:#176c1f;}'
		+ '.vw-keys{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}'
		+ '.vw-key{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border:1px solid #c5cad2;border-bottom-width:2px;border-radius:4px;background:#fff;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;color:#1f2328;}'
		+ '.vw-keys .vw-sep{color:#94979d;}'
		// Footer-Action-Button: immer grün. Der Text wechselt je nach
		// Decision-State zwischen "✓ Alle annehmen" und "Übernehmen",
		// damit dem Redakteur klar ist ob bei Klick alles angenommen
		// wird oder seine manuelle Auswahl übernommen — der Button-Look
		// bleibt gleich.
		+ '.vw-footer-action{appearance:none;border:1px solid #176c1f;background:#176c1f;color:#fff;border-radius:6px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;line-height:1.2;transition:background-color .15s ease,border-color .15s ease;}'
		+ '.vw-footer-action:hover{background:#125a18;border-color:#125a18;}'
		// Fade-out-Animation beim Schließen — kurz und unaufdringlich.
		// Der User soll noch sehen, dass alle Haken grün werden, bevor
		// das Modal weg ist. CSS-Transition läuft parallel zum DOM-Update.
		+ '.vw-overlay{transition:opacity .18s ease;}'
		+ '.vw-modal{transition:transform .18s ease,opacity .18s ease;}'
		+ '.vw-overlay.vw-closing{opacity:0;pointer-events:none;}'
		+ '.vw-overlay.vw-closing .vw-modal{transform:scale(.97);}'

		// Widget runs in light mode only — no @media prefers-color-scheme.
	;

	function inject_css() {
		if( document.getElementById( 'vw-style' ) ) { return; }
		var s = document.createElement( 'style' );
		s.id = 'vw-style';
		s.textContent = CSS;
		document.head.appendChild( s );
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   OS-spezifische Tastatur-Anzeige
	//
	//   - Mac:        ⏎ / ␣ / ⎋ Symbole
	//   - Windows:    "Enter" / "Leer" / "Esc"
	//   - Linux:      wie Windows
	//   - Mobile/Touch ohne Hover: Tastatur-Tipps werden komplett ausgeblendet
	// ────────────────────────────────────────────────────────────────────────────
	//

	function detect_os() {
		var p = ( navigator.platform || '' ).toLowerCase();
		var ua = ( navigator.userAgent || '' ).toLowerCase();
		if( /iphone|ipad|ipod/.test( ua ) ) { return 'ios'; }
		if( /android/.test( ua ) ) { return 'android'; }
		if( /mac/.test( p ) || /mac/.test( ua ) ) { return 'mac'; }
		if( /win/.test( p ) || /windows/.test( ua ) ) { return 'win'; }
		if( /linux/.test( p ) || /linux/.test( ua ) ) { return 'linux'; }
		return 'other';
	}

	function has_physical_keyboard() {
		var os = detect_os();
		if( os === 'ios' || os === 'android' ) { return false; }
		// `any-hover: hover` indicates a hover-capable pointer (mouse) is
		// available, which on desktop OSes also implies a keyboard.
		if( typeof window.matchMedia === 'function' ) {
			try {
				if( !window.matchMedia( '(any-hover: hover)' ).matches ) { return false; }
			} catch( e ) { /* noop */ }
		}
		return true;
	}

	function key_labels() {
		return { up: '↑', down: '↓', left: '←', right: '→' };
	}

	function keys_footer_html() {
		if( !has_physical_keyboard() ) { return ''; }
		var k = key_labels();
		// Tastatur-Hint im Footer. Das vorangestellte "TASTENKÜRZEL"-Label
		// macht klar, dass die Tasten-Boxen daneben Shortcuts sind und
		// keine reine Dekoration. Enter ist der neue Primary-Shortcut für
		// den Footer-Button.
		return ''
			+ '<span class="vw-legend-label">Tastenkürzel</span>'
			+ '<span class="vw-keys">'
			+ '<span class="vw-key">' + k.up + '</span><span class="vw-sep">/</span><span class="vw-key">' + k.down + '</span> Absatz'
			+ '<span class="vw-sep">·</span>'
			+ '<span class="vw-key">' + k.right + '</span> annehmen'
			+ '<span class="vw-sep">·</span>'
			+ '<span class="vw-key">' + k.left + '</span> ablehnen'
			+ '<span class="vw-sep">·</span>'
			+ '<span class="vw-key">Enter</span> übernehmen'
			+ '</span>';
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   2. Tokenizer + diff (used for the *inner* per-paragraph word diff)
	// ────────────────────────────────────────────────────────────────────────────
	//

	// TOKEN_RE-Alternativen, von oben nach unten geprüft:
	//   1. HTML-Tag
	//   2. ##shortcode##  — Inhalt darf einzelne `#` enthalten
	//      (z. B. `farbe="#ff7f01"` Hex-Codes); nur das `##`-Schluss-Sentinel
	//      darf nicht im Inhalt vorkommen. Ohne dieses Detail wäre der
	//      Tokenizer früher beim ersten Inhalt-`#` ausgestiegen und hätte
	//      die `##`-Begrenzer komplett verschluckt — Source-Bytes weg.
	//   3. Wort
	//   4. Whitespace
	//   5. einzelnes Sonderzeichen (jetzt INKLUSIVE `#`, damit verirrte
	//      `#` nicht spurlos verschwinden, falls Pattern 2 oben nicht greift)
	var TOKEN_RE = /<\/?[a-zA-Z][^>]*>|##(?:[^#\n]|#(?!#))*?##|[A-Za-zÀ-ɏ0-9_]+|\s+|[^\sA-Za-zÀ-ɏ0-9_<]/g;

	function tokenize( text ) {
		if( !text ) { return []; }
		var out = [];
		var m;
		TOKEN_RE.lastIndex = 0;
		while( ( m = TOKEN_RE.exec( text ) ) !== null ) { out.push( m[ 0 ] ); }
		return out;
	}

	function escape_html( s ) {
		return s
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#39;' );
	}

	function lcs( a, b ) {
		var n = a.length, m = b.length;
		if( n === 0 ) { return b.map( function( t ) { return { op: 'ins', text: t }; } ); }
		if( m === 0 ) { return a.map( function( t ) { return { op: 'del', text: t }; } ); }

		var dp = new Array( n + 1 );
		for( var i = 0; i <= n; i++ ) { dp[ i ] = new Uint32Array( m + 1 ); }
		for( var ii = 1; ii <= n; ii++ ) {
			for( var jj = 1; jj <= m; jj++ ) {
				if( a[ ii - 1 ] === b[ jj - 1 ] ) {
					dp[ ii ][ jj ] = dp[ ii - 1 ][ jj - 1 ] + 1;
				} else {
					dp[ ii ][ jj ] = dp[ ii - 1 ][ jj ] >= dp[ ii ][ jj - 1 ] ? dp[ ii - 1 ][ jj ] : dp[ ii ][ jj - 1 ];
				}
			}
		}

		var out = [];
		var x = n, y = m;
		while( x > 0 && y > 0 ) {
			if( a[ x - 1 ] === b[ y - 1 ] ) { out.push( { op: 'eq', text: a[ x - 1 ] } ); x--; y--; }
			else if( dp[ x - 1 ][ y ] >= dp[ x ][ y - 1 ] ) { out.push( { op: 'del', text: a[ x - 1 ] } ); x--; }
			else { out.push( { op: 'ins', text: b[ y - 1 ] } ); y--; }
		}
		while( x > 0 ) { out.push( { op: 'del', text: a[ --x ] } ); }
		while( y > 0 ) { out.push( { op: 'ins', text: b[ --y ] } ); }
		out.reverse();
		return out;
	}

	function diff_tokens( a, b ) {
		var n = a.length, m = b.length;
		var prefix = 0;
		while( prefix < n && prefix < m && a[ prefix ] === b[ prefix ] ) { prefix++; }
		var suffix = 0;
		while(
			suffix < ( n - prefix )
			&& suffix < ( m - prefix )
			&& a[ n - 1 - suffix ] === b[ m - 1 - suffix ]
		) { suffix++; }

		var a_mid = a.slice( prefix, n - suffix );
		var b_mid = b.slice( prefix, m - suffix );
		var middle = lcs( a_mid, b_mid );

		var ops = [];
		for( var i = 0; i < prefix; i++ ) { ops.push( { op: 'eq', text: a[ i ] } ); }
		for( var j = 0; j < middle.length; j++ ) { ops.push( middle[ j ] ); }
		for( var k = n - suffix; k < n; k++ ) { ops.push( { op: 'eq', text: a[ k ] } ); }
		return merge_adjacent( ops );
	}

	function merge_adjacent( ops ) {
		var merged = [];
		for( var i = 0; i < ops.length; i++ ) {
			var last = merged[ merged.length - 1 ];
			if( last && last.op === ops[ i ].op ) { last.text += ops[ i ].text; }
			else { merged.push( { op: ops[ i ].op, text: ops[ i ].text } ); }
		}
		return merged;
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   3. Paragraph splitting
	//
	//   Boundaries we recognize:
	//     - one-or-more newlines  (\n+)
	//     - two or more <br/>     (<br><br>, <br/><br/>, …)
	//     - any closing block tag (</h1-6>, </p>, </li>, </blockquote>, …)
	//     - a stand-alone block shortcode (##contentad##, ##video##, ##gallery##,
	//       ##embed##, ##iframe##, ##twitter##, ##instagram##, ##youtube##) —
	//       its own paragraph so it can be aligned/skipped without disturbing
	//       neighbouring text
	//   The boundary text is included at the END of the preceding paragraph,
	//   so concatenating all paragraphs reproduces the input exactly.
	// ────────────────────────────────────────────────────────────────────────────
	//

	var BLOCK_SHORTCODE_NAMES = 'contentad|video|gallery|embed|iframe|twitter|instagram|youtube';
	var PARA_BOUNDARY_RE = new RegExp(
		'\\n+'
		+ '|<br\\s*\\/?>(?:\\s*<br\\s*\\/?>)+'
		+ '|<\\/(?:h[1-6]|p|li|blockquote|div|section|article|aside|figure|figcaption|header|footer|main)>'
		+ '|##(?:' + BLOCK_SHORTCODE_NAMES + ')(?:\\s[^#]*?)?##',
		'gi'
	);

	// Bekannte WinFuture-Block-Patterns, die der Splitter NICHT zerlegen
	// darf, weil ihr HTML im Source bewusst balanced ist und ein nur
	// teilweise akzeptierter Block ein offenes `<div>` im Editor hinterlässt.
	// Konkret betroffen:
	//   * summary_box (KI-generierte Zusammenfassung samt umschließendem
	//     `<br/><br/>`-Vorlauf)
	//   * siehe_auch (Liste verwandter Artikel inklusive vorangestelltem
	//     "Siehe auch:"-Header)
	// Beide Blöcke landen jeweils als EIN Paragraph in der Diff-Engine,
	// werden also als Ganzes angenommen oder verworfen.
	// Detektoren für bekannte WinFuture-Block-Patterns. Jeder Detektor
	// matched zuerst eine OPENING-Sequenz (Vorlauf + erstes <div>) per
	// Regex, danach wird das passende </div> mit find_balanced_close
	// gesucht — damit funktionieren auch verschachtelte <div>-Strukturen
	// wie wfv4-accordion oder summary_box mit innerem changelog_list.
	var ATOMIC_BLOCK_DETECTORS = [
		// summary_box mit optionalem <br/><br/>-Vorlauf.
		{
			name: 'summary_box',
			open_re: /\s*(?:<br\s*\/?>\s*)*\s*<div\s+class\s*=\s*["'][^"']*\bsummary_box\b[^"']*["'][^>]*>/gi,
			close_tag: 'div'
		},
		// <b>Header</b> + optionaler <br/> + <div class="…changelog_list…">…</div>.
		// Deckt sowohl `siehe_auch` als auch `colored` und alle anderen
		// changelog_list-Klassenvarianten ab, solange ein kurzer <b>-Header
		// direkt davor steht. Der Header-Inhalt darf keine weiteren Tags
		// enthalten ([^<]*).
		{
			name: 'changelog_list_with_header',
			open_re: /\s*<b\b[^>]*>[^<]{1,200}<\/b\s*>\s*(?:<br\s*\/?>\s*)?\s*<div\s+class\s*=\s*["'][^"']*\bchangelog_list\b[^"']*["'][^>]*>/gi,
			close_tag: 'div'
		},
		// Standalone-Variante: <div class="…changelog_list…">…</div> OHNE
		// vorangestellten <b>-Header. Wird gebraucht, wenn die KI z. B.
		// eine Bullet-Liste mit Tarif-Details direkt einfügt. Wenn dieser
		// Block innerhalb einer summary_box steht, übernimmt die overlap-
		// Resolution in pre_extract_atomic_blocks das Ignorieren —
		// summary_box matched den umschließenden Block und der inner
		// changelog_list-Hit wird verworfen.
		{
			name: 'changelog_list_standalone',
			open_re: /\s*<div\s+class\s*=\s*["'][^"']*\bchangelog_list\b[^"']*["'][^>]*>/gi,
			close_tag: 'div'
		},
		// FAQ-Akkordeon: <div class="wfv4-accordion"> mit verschachtelten
		// <details>-Elementen. find_balanced_close zählt <div>-Nesting.
		{
			name: 'wfv4_accordion',
			open_re: /\s*<div\s+class\s*=\s*["'][^"']*\bwfv4-accordion\b[^"']*["'][^>]*>/gi,
			close_tag: 'div'
		},
		// <table class="wftable …">…</table> — WinFuture-typische Tarif-
		// und Spec-Tabellen. Wird als Block angenommen oder verworfen,
		// damit ein partielles Akzeptieren nicht den </table>-Tag verliert.
		{
			name: 'wftable',
			open_re: /\s*<table\s+class\s*=\s*["'][^"']*\bwftable\b[^"']*["'][^>]*>/gi,
			close_tag: 'table'
		}
	];

	// Sucht ab `start_pos` das passende </tag> mit Nesting-Counter, sodass
	// inner <tag>…</tag>-Paare das Ende NICHT vorzeitig markieren.
	function find_balanced_close( text, start_pos, tag_name ) {
		var re = new RegExp( '<\\/?' + tag_name + '\\b[^>]*>', 'gi' );
		re.lastIndex = start_pos;
		var depth = 1;
		var m;

		while( ( m = re.exec( text ) ) !== null ) {
			if( m[ 0 ].charAt( 1 ) === '/' ) {
				depth--;
				if( depth === 0 ) { return m.index + m[ 0 ].length; }
			} else {
				depth++;
			}
		}
		return -1;
	}

	// Vor dem normalen Paragraph-Splitting werden bekannte Block-Patterns
	// (siehe ATOMIC_BLOCK_PATTERNS) als geschlossene Einheiten markiert.
	// Der Rest läuft durchs normale Splitting; die atomic Blöcke kommen
	// am Stück in die Paragraph-Liste.
	function pre_extract_atomic_blocks( text ) {
		var hits = [];

		for( var p = 0; p < ATOMIC_BLOCK_DETECTORS.length; p++ ) {
			var det = ATOMIC_BLOCK_DETECTORS[ p ];
			var re = new RegExp( det.open_re.source, det.open_re.flags );
			var m;
			while( ( m = re.exec( text ) ) !== null ) {
				var open_end = m.index + m[ 0 ].length;
				var close_end = find_balanced_close( text, open_end, det.close_tag );

				if( close_end === -1 ) { continue; }
				hits.push( { start: m.index, end: close_end } );
				// Suche im selben Detektor nach weiteren Vorkommen erst HINTER
				// dem geschlossenen Block — sonst würden überlappende inner-Tags
				// nochmal triggern.
				re.lastIndex = close_end;
			}
		}

		if( hits.length === 0 ) { return [ { type: 'normal', text: text } ]; }

		hits.sort( function( a, b ) { return a.start - b.start; } );

		// Overlapping matches auflösen — erst gefundener Hit gewinnt.
		var clean = [];

		for( var h = 0; h < hits.length; h++ ) {
			if( clean.length === 0 || hits[ h ].start >= clean[ clean.length - 1 ].end ) {
				clean.push( hits[ h ] );
			}
		}

		var segments = [];
		var pos = 0;

		for( var k = 0; k < clean.length; k++ ) {
			if( clean[ k ].start > pos ) {
				segments.push( { type: 'normal', text: text.slice( pos, clean[ k ].start ) } );
			}
			segments.push( { type: 'atomic', text: text.slice( clean[ k ].start, clean[ k ].end ) } );
			pos = clean[ k ].end;
		}

		if( pos < text.length ) {
			segments.push( { type: 'normal', text: text.slice( pos ) } );
		}

		return segments;
	}

	function split_paragraphs_normal( text ) {
		var paragraphs = [];
		var last = 0;
		var re = new RegExp( PARA_BOUNDARY_RE.source, PARA_BOUNDARY_RE.flags );
		var m;
		while( ( m = re.exec( text ) ) !== null ) {
			var end_of_para = m.index + m[ 0 ].length;
			paragraphs.push( text.slice( last, end_of_para ) );
			last = end_of_para;
		}
		if( last < text.length ) { paragraphs.push( text.slice( last ) ); }
		return paragraphs;
	}

	function split_paragraphs( text ) {
		var segments = pre_extract_atomic_blocks( text );
		var paragraphs = [];

		for( var s = 0; s < segments.length; s++ ) {
			if( segments[ s ].type === 'atomic' ) {
				paragraphs.push( segments[ s ].text );
			} else {
				var sub = split_paragraphs_normal( segments[ s ].text );

				for( var t = 0; t < sub.length; t++ ) { paragraphs.push( sub[ t ] ); }
			}
		}

		while( paragraphs.length > 0 && paragraphs[ 0 ] === '' ) { paragraphs.shift(); }

		// Merge structural-empty chunks (only whitespace and <br/> etc., no
		// visible content, no shortcodes) into the preceding paragraph so
		// they are never displayed as their own row. The raw text stays
		// part of the merged paragraph, so byte-exact resolve is preserved.
		var merged = [];
		for( var i = 0; i < paragraphs.length; i++ ) {
			var p = paragraphs[ i ];
			if( is_structural_only( p ) ) {
				if( merged.length > 0 ) {
					merged[ merged.length - 1 ] += p;
				} else if( i + 1 < paragraphs.length ) {
					paragraphs[ i + 1 ] = p + paragraphs[ i + 1 ];
				}
			} else {
				merged.push( p );
			}
		}

		// Heading-only-Paragraphen bleiben als eigene Zeilen im Grid.
		// Früher haben wir sie in den nachfolgenden Body-Absatz gemergt,
		// damit die Überschrift fett am Anfang des Body-Cells erscheint.
		// Das hat den Diff aber zerschossen, sobald eine Seite Headings
		// als `<h2>…</h2>` setzt und die andere Plain-Text — split_paragraphs
		// produzierte dann unterschiedlich viele Paragraphen und das
		// Paragraph-LCS lief schief (Add+Del-Lawinen statt Mod-Pairs).
		//
		// Im Lesbar-Modus rendert der `<h1>`-`<h6>`-Inhalt weiterhin
		// fett via CSS, jetzt eben in einer eigenen Zeile statt inline
		// am Body-Anfang — das ist sogar etwas lesbarer und der Redakteur
		// kann Heading und Body separat akzeptieren/ablehnen.

		// Listen-Items bleiben hier als separate Paragraphen. Aggregation
		// passiert später in build_rows_from_paras (group_list_adds_dels)
		// — nur Add/Del-Blöcke werden zusammengefasst, Mod- und Eq-Items
		// bleiben einzeln, damit eine Item-Änderung in einer Bestandsliste
		// nicht die ganze Liste hervorhebt.
		return merged;
	}

	function is_list_part( text ) {
		// Paragraph zählt zu einem Listen-Block, wenn er Listen-Markup
		// enthält (öffnende oder schließende `<ul>`, `<ol>`, `<li>`).
		return /<\/?(?:ul|ol|li)\b/i.test( text );
	}

	function is_just_heading( text ) {
		// True if the paragraph contains exactly one heading element and
		// nothing else of visible content (whitespace allowed).
		if( !/<h[1-6]\b/i.test( text ) ) { return false; }
		var without_heading = text.replace( /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, '' );
		return without_heading.replace( /\s+/g, '' ).length === 0;
	}

	// "Structural-only" means: nothing left after dropping all HTML tags and
	// whitespace. So <br/><br/>, lone \n, <p></p>, <div></div> all qualify.
	// Shortcodes like ##contentad## are NOT structural — they get their own row.
	// Listen-Wrapper-Tags (`<ul>`, `<ol>`, `</ul>`, `</ol>`) bleiben als
	// eigene Paragraphen erhalten, damit der spätere list_merge-Schritt
	// sie mit den `<li>`-Items zu EINEM Block fügen kann, statt dass
	// ein `<ul>\n` rückwärts in einen Body-Paragraph wandert und die
	// Liste anschließend nicht mehr klar erkennbar ist.
	function is_structural_only( text ) {
		var stripped = text.replace( /<[^>]+>/g, '' ).replace( /\s+/g, '' );

		if( stripped.length > 0 ) { return false; }
		if( /<\/?(?:ul|ol)\b/i.test( text ) ) { return false; }
		return true;
	}

	// Trim leading/trailing whitespace and <br/> tags for display only. The
	// raw text is preserved on the row and used by resolve_text so the result
	// remains byte-exact with the input.
	function trim_display( text ) {
		return text
			.replace( /^(?:\s|<br\s*\/?>)+/gi, '' )
			.replace( /(?:\s|<br\s*\/?>)+$/gi, '' );
	}

	// Inline-Wrapper- und Whitespace-Tags, die für die Eq-Detection als
	// "unsichtbar" gelten. Diese Tags wirken visuell — ihre PRÄSENZ ist
	// relevant, aber ihre POSITION nicht: wenn die KI z. B. einen `<b>`-
	// Tag eine Newline früher oder später setzt, sollten beide Paragraphen
	// trotzdem als gleich erkannt werden. Semantisch trennende Tags wie
	// `<a>` (Link), `<h1>`–`<h6>` (Überschrift), `<p>`, `<div>` etc.
	// bleiben für den Vergleich erhalten, damit echte Struktur-Änderungen
	// sichtbar werden.
	var EQ_INLINE_TAGS = /<\/?(?:br|b|i|em|strong|u|s|strike|sub|sup|small|big|tt|mark|nobr|span)\s*[^>]*?\/?>/gi;

	// Kanonische Form für VERGLEICHE — Inline-Wrapper und Whitespace
	// auf ein Space kollabieren. `trim_display` strippt nur außen,
	// deshalb würden Heading-Merges wie `<h2>X</h2>\n\nBody…` vs
	// `<h2>X</h2>\nBody…` sonst als Mod-Zeile auftauchen. Ebenso erkennt
	// `compare_norm` Verschiebungen reiner Inline-Wrapper (z. B. wenn
	// `<b>` im Source einen Absatz früher öffnet als auf der anderen
	// Seite und durch den structural-empty-Merge an einer anderen
	// Paragraph-Grenze landet) — visuell sind beide identisch, also
	// sollen sie nicht als Änderung erscheinen. Die Original-Bytes
	// bleiben in row.before/row.after erhalten und werden bei
	// resolve_text byte-exakt zurückgegeben.
	function compare_norm( text ) {
		return text
			.replace( EQ_INLINE_TAGS, ' ' )
			.replace( /\s+/g, ' ' )
			.trim();
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   4. Visible text — extract the user-readable content from a paragraph.
	//      Used for similarity matching to align "modified" pairs intelligently.
	// ────────────────────────────────────────────────────────────────────────────
	//

	function visible_text( paragraph ) {
		// Remove all HTML tags, remove non-##a## shortcodes, keep ##a##'s text.
		var stripped = paragraph
			.replace( /##\s*a\s+([^#]*?)##/gi, function( _, attrs ) {
				var t = /\bt\s*=\s*"([^"]*)"/i.exec( attrs ) || /\bt\s*=\s*'([^']*)'/i.exec( attrs );
				return t ? t[ 1 ] : '';
			} )
			.replace( /##[^#]*?##/g, '' )
			.replace( /<[^>]+>/g, ' ' )
			.replace( /\s+/g, ' ' )
			.trim();
		return stripped;
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   5. Build aligned rows from the two paragraph arrays.
	//
	//   Strategy:
	//     1. LCS over the raw paragraph strings (literal equality).
	//     2. Walk the resulting ops; pair each del run with the immediately
	//        following ins run as a "mod" row (so a slightly modified paragraph
	//        sits on the same row as its older self).
	//     3. Lone del → "del" row (paragraph removed)
	//        Lone ins → "add" row (paragraph added)
	//        eq      → "eq" row (no decision needed)
	//     4. For "mod" rows, also compute the inner word-level diff so we can
	//        highlight what changed.
	// ────────────────────────────────────────────────────────────────────────────
	//

	// Normalize input to a {headline, teaser, content} bundle.
	// Accepts either a string (treated as content) or an object with any
	// subset of headline/teaser/content. Missing fields default to ''.
	function normalize_bundle( input ) {
		if( input == null ) { return { headline: '', teaser: '', content: '' }; }
		if( typeof input === 'string' ) {
			return { headline: '', teaser: '', content: input };
		}
		return {
			headline: input.headline || '',
			teaser: input.teaser || '',
			content: input.content || ''
		};
	}

	function build_rows( before_input, after_input ) {
		var before = normalize_bundle( before_input );
		var after = normalize_bundle( after_input );
		var rows = [];

		// Run a separate paragraph-level diff for each section so changes
		// in the headline can't shift the alignment of the body, and so the
		// user-supplied semantic structure (Überschrift / Teaser / Body) is
		// always preserved 1:1 in the output.
		append_section_rows( rows, before.headline, after.headline, 'headline' );
		append_section_rows( rows, before.teaser, after.teaser, 'teaser' );
		append_section_rows( rows, before.content, after.content, null );

		// Reassign sequential global IDs across all sections.
		for( var i = 0; i < rows.length; i++ ) { rows[ i ].id = i; }

		// Stable line numbers only for body-content rows. Headline and Teaser
		// have their own section labels and need no number.
		var line_num = 0;
		for( var n = 0; n < rows.length; n++ ) {
			if( !rows[ n ].section ) {
				line_num++;
				rows[ n ].line_number = line_num;
			}
		}

		// Tag the FIRST row of each section so the CSS section-label
		// ("Überschrift" / "Teaser") only appears once per section, not on
		// every row when a section spans multiple paragraphs.
		var seen_section = {};
		for( var s = 0; s < rows.length; s++ ) {
			if( rows[ s ].section && !seen_section[ rows[ s ].section ] ) {
				rows[ s ].section_start = true;
				seen_section[ rows[ s ].section ] = true;
			}
		}

		return rows;
	}

	function append_section_rows( target, before_text, after_text, section_name ) {
		// A section is shown only if at least one side has actual content
		// (whitespace doesn't count). Otherwise the section header would
		// appear over an empty cell, which is confusing — better to omit
		// the whole section.
		var b = ( before_text || '' );
		var a = ( after_text || '' );
		if( b.replace( /\s+/g, '' ).length === 0 && a.replace( /\s+/g, '' ).length === 0 ) {
			return;
		}
		var before_ps = split_paragraphs( b );
		var after_ps = split_paragraphs( a );
		var section_rows = build_rows_from_paras( before_ps, after_ps );
		for( var i = 0; i < section_rows.length; i++ ) {
			if( section_name ) { section_rows[ i ].section = section_name; }
			target.push( section_rows[ i ] );
		}
	}

	function row_has_visible_content( row ) {
		var b = row.before_display || '';
		var a = row.after_display || '';
		// "Visible" = has text after stripping ALL HTML tags and shortcodes.
		// (Pure ##contentad##, ##video##, etc. paragraphs render as empty.)
		function clean( s ) {
			return s.replace( /<[^>]+>/g, '' ).replace( /##[^#\n]*?##/g, '' ).replace( /\s+/g, '' );
		}
		return clean( b ).length > 0 || clean( a ).length > 0;
	}

	function build_rows_from_paras( before_ps, after_ps ) {
		var para_ops = lcs( before_ps, after_ps );

		// merge adjacent same-op runs of paragraph-level ops so dels & ins arrive in groups
		var grouped = [];
		for( var i = 0; i < para_ops.length; i++ ) {
			var last = grouped[ grouped.length - 1 ];
			if( last && last.op === para_ops[ i ].op ) { last.items.push( para_ops[ i ].text ); }
			else { grouped.push( { op: para_ops[ i ].op, items: [ para_ops[ i ].text ] } ); }
		}

		var rows = [];
		var rowId = 0;
		var idx = 0;

		while( idx < grouped.length ) {
			var grp = grouped[ idx ];

			if( grp.op === 'eq' ) {
				for( var k = 0; k < grp.items.length; k++ ) {
					var t = trim_display( grp.items[ k ] );
					rows.push( {
						id: rowId++, type: 'eq',
						before: grp.items[ k ], after: grp.items[ k ],
						before_display: t, after_display: t,
						decision: null
					} );
				}
				idx++;
				continue;
			}

			// Pool all consecutive non-eq groups (the LCS may emit dels and ins
			// in either order; we pair them after pooling so a del+ins from
			// different LCS positions can still become a "mod" row).
			var dels = [];
			var ins = [];
			while( idx < grouped.length && grouped[ idx ].op !== 'eq' ) {
				if( grouped[ idx ].op === 'del' ) { dels = dels.concat( grouped[ idx ].items ); }
				else { ins = ins.concat( grouped[ idx ].items ); }
				idx++;
			}

			var pairs = pair_similar( dels, ins );
			for( var p = 0; p < pairs.length; p++ ) {
				var pr = pairs[ p ];
				if( pr.before != null && pr.after != null ) {
					var bt = trim_display( pr.before );
					var at = trim_display( pr.after );
					// Skip mod-rows that only differ in whitespace (incl. inner
					// `\n+`, `<br>` etc.) — that's noise from heading merges and
					// KI-Reformatierungen, nichts was der Redakteur entscheiden
					// soll. Both raw values are kept; we treat the row as eq
					// for display and pick the NACHHER raw on resolve so
					// "accept all" stays byte-exact with the new version.
					if( compare_norm( bt ) === compare_norm( at ) ) {
						rows.push( {
							id: rowId++, type: 'eq',
							before: pr.after, after: pr.after,
							before_display: bt, after_display: at,
							decision: null,
							raw_before: pr.before, raw_after: pr.after
						} );
					} else {
						rows.push( {
							id: rowId++, type: 'mod',
							before: pr.before, after: pr.after,
							before_display: bt, after_display: at,
							decision: null,
							inner_ops: diff_tokens( tokenize( bt ), tokenize( at ) )
						} );
					}
				} else if( pr.before != null ) {
					rows.push( {
						id: rowId++, type: 'del',
						before: pr.before, after: '',
						before_display: trim_display( pr.before ), after_display: '',
						decision: null
					} );
				} else {
					rows.push( {
						id: rowId++, type: 'add',
						before: '', after: pr.after,
						before_display: '', after_display: trim_display( pr.after ),
						decision: null
					} );
				}
			}
		}

		return group_list_adds_dels( rows );
	}

	// Post-Process: aufeinanderfolgende Add-Rows (oder Del-Rows), die
	// alle aus Listen-Markup bestehen (`<ul>`, `<ol>`, `<li>`-Tags) werden
	// zu einer einzigen Block-Row zusammengefasst. Damit wird eine neu
	// hinzugefügte oder entfernte Liste (z. B. eine KI-Summary-Box) als
	// EIN Block annehmbar/ablehnbar — statt N einzelne Bullet-Reihen
	// mit jeweils eigenen ✓/×-Buttons.
	//
	// Mod-Rows werden NICHT aggregiert, sodass eine einzelne Wort-
	// Änderung in einem bestehenden Listen-Item weiterhin als einzelnes
	// Item-Diff sichtbar wird, statt die ganze Liste als Mod zu markieren.
	// Eq-Rows brechen einen laufenden Block ebenfalls auf (Listen-Anfang
	// gehört nicht zu unverändertem Body).
	function group_list_adds_dels( rows ) {
		var out = [];
		var i = 0;

		while( i < rows.length ) {
			var row = rows[ i ];
			var collapsible = ( row.type === 'add' || row.type === 'del' ) && is_list_part( row.type === 'add' ? row.after : row.before );

			if( !collapsible ) {
				out.push( row );
				i++;
				continue;
			}

			// Look ahead: alle aufeinanderfolgenden Rows desselben Typs (add
			// oder del), deren Inhalt list_part ist.
			var j = i + 1;

			while( j < rows.length ) {
				var next = rows[ j ];

				if( next.type !== row.type ) { break; }
				if( !is_list_part( row.type === 'add' ? next.after : next.before ) ) { break; }
				j++;
			}

			if( j === i + 1 ) {
				out.push( row );
				i++;
				continue;
			}

			// Mehrere — aggregiere zu einer Block-Row.
			var slice = rows.slice( i, j );
			var combined_before = '';
			var combined_after = '';

			for( var k = 0; k < slice.length; k++ ) {
				combined_before += slice[k].before || '';
				combined_after += slice[k].after || '';
			}

			out.push( {
				id: row.id, type: row.type,
				section: row.section,
				before: combined_before, after: combined_after,
				before_display: trim_display( combined_before ),
				after_display: trim_display( combined_after ),
				decision: null
			} );
			i = j;
		}

		return out;
	}

	// Pair removed and added paragraphs using Jaccard similarity on the
	// visible text. The aim is: paragraphs that differ only slightly (typical
	// edit) end up on the same row; brand-new paragraphs and fully-removed
	// paragraphs become lone add/del rows.
	function pair_similar( dels, ins ) {
		var nD = dels.length, nI = ins.length;
		if( nD === 0 ) { return ins.map( function( t ) { return { before: null, after: t }; } ); }
		if( nI === 0 ) { return dels.map( function( t ) { return { before: t, after: null }; } ); }

		var d_vis = dels.map( visible_text );
		var i_vis = ins.map( visible_text );

		// Symmetric (Hungarian-light) best-match pairing — sammle ALLE
		// Pair-Kandidaten oberhalb der Threshold, sortiere nach Score
		// und nimm pro Iteration das beste noch freie Paar. Anders als
		// das alte Greedy-by-d-Verfahren wird so nicht der erste del
		// zur Ressourcen-Bremse für besser passende spätere dels — der
		// im pair_by_d-Greedy häufige Effekt, dass ein "okay" Pair einem
		// "perfekten" Pair gleich daneben den Slot wegschnappt.
		var SIM_THRESHOLD = 0.2;
		var candidates = [];

		for( var di = 0; di < nD; di++ ) {
			for( var ii = 0; ii < nI; ii++ ) {
				var s = similarity( d_vis[ di ], i_vis[ ii ] );
				if( s > SIM_THRESHOLD ) {
					candidates.push( { di: di, ii: ii, score: s } );
				}
			}
		}

		// Score absteigend; bei Gleichstand das diagonalere Pair zuerst,
		// damit die natürliche Vorher/Nachher-Reihenfolge erhalten bleibt.
		candidates.sort( function( a, b ) {
			if( b.score !== a.score ) { return b.score - a.score; }
			return Math.abs( a.di - a.ii ) - Math.abs( b.di - b.ii );
		});

		var used_d = {};
		var used_i = {};
		var pairs_by_del = new Array( nD );

		for( var kk = 0; kk < nD; kk++ ) { pairs_by_del[ kk ] = -1; }

		for( var c = 0; c < candidates.length; c++ ) {
			var cand = candidates[ c ];

			if( used_d[ cand.di ] || used_i[ cand.ii ] ) { continue; }
			pairs_by_del[ cand.di ] = cand.ii;
			used_d[ cand.di ] = true;
			used_i[ cand.ii ] = true;
		}

		// Re-emit in a stable order: walk the longer side (whichever had the
		// most original entries) and emit each item in the position that
		// preserves "Vorher reads top-to-bottom". A pure ordered list of
		// (di, ii) entries maintains the original sequence.
		var out = [];
		var emitted_i = {};
		for( var d = 0; d < nD; d++ ) {
			var match = pairs_by_del[ d ];
			if( match !== -1 ) {
				// Emit any unmatched ins that come before this match (additions
				// inserted between paragraphs)
				for( var queued = 0; queued < match; queued++ ) {
					if( !used_i[ queued ] && !emitted_i[ queued ] ) {
						out.push( { before: null, after: ins[ queued ] } );
						emitted_i[ queued ] = true;
					}
				}
				out.push( { before: dels[ d ], after: ins[ match ] } );
				emitted_i[ match ] = true;
			} else {
				out.push( { before: dels[ d ], after: null } );
			}
		}
		// Trailing unmatched ins
		for( var t = 0; t < nI; t++ ) {
			if( !emitted_i[ t ] ) { out.push( { before: null, after: ins[ t ] } ); }
		}
		return out;
	}

	// Ähnlichkeit zweier Paragraphen-Visible-Texts, in [0..1].
	//
	// Klassisches Jaccard (|A∩B| / |A∪B|) bestraft stark unterschiedlich
	// lange Paragraphen — z. B. wenn die KI einen `<h2>`-Tag eingefügt
	// oder entfernt hat und der Heading-Merge auf den beiden Seiten zu
	// unterschiedlich großen Paragraphen führt. „Vorteile sind groß"
	// (3 Wörter) komplett enthalten in „Vorteile sind groß Microsoft hat
	// dafür …" (30 Wörter) ergibt Jaccard 3/30 = 0.1 — unter unserer
	// 0.2-Schwelle, also kein Pair. Resultat: Vorher- und Nachher-
	// Paragraph laufen als separate del / add nebeneinander her, obwohl
	// sie offensichtlich zusammengehören.
	//
	// Lösung: Wenn mind. 3 unique Wörter gemeinsam sind UND die kleinere
	// Seite eine starke Untermenge der größeren ist (Overlap ≥ 0.7),
	// gewichten wir Jaccard und Overlap zu gleichen Teilen. So pairen
	// gefühlt-zusammengehörige Paragraphen, ohne dass „Der" als
	// gemeinsames Stoppwort schon ein False-Match auslöst.
	// Tokenisiert Text für den Similarity-Vergleich. Splittet an
	// Whitespace UND Bindestrichen — letzteres weil die KI häufig
	// Durchkopplung korrigiert ("SMS / Telefon Flat" → "SMS- / Telefon-Flat")
	// und die Original-Strings bei reinem Whitespace-Split kaum
	// Überlappung haben (sms vs sms-, telefon+flat vs telefon-flat).
	// Mit Hyphen-Split fallen beide auf dieselbe Wortmenge zurück.
	function compare_words( text ) {
		return text.toLowerCase().split( /[\s\-]+/ ).filter( Boolean );
	}

	function similarity( a, b ) {
		if( !a && !b ) { return 1; }
		if( !a || !b ) { return 0; }

		var wa = compare_words( a );
		var wb = compare_words( b );

		if( wa.length === 0 || wb.length === 0 ) { return 0; }

		var sa = {};
		var sb = {};
		var na = 0, nb = 0;

		for( var i = 0; i < wa.length; i++ ) {
			if( !sa[ wa[ i ] ] ) { sa[ wa[ i ] ] = true; na++; }
		}

		for( var j = 0; j < wb.length; j++ ) {
			if( !sb[ wb[ j ] ] ) { sb[ wb[ j ] ] = true; nb++; }
		}

		var inter = 0;

		for( var k in sa ) {
			if( sb[ k ] ) { inter++; }
		}

		if( inter === 0 ) { return 0; }

		var union_size = na + nb - inter;
		var jacc = inter / union_size;
		var min_size = Math.min( na, nb );
		var overlap = inter / min_size;

		if( inter >= 3 && overlap >= 0.7 ) {
			return ( jacc + overlap ) / 2;
		}
		return jacc;
	}

	// Backwards-Compat: einige Aufrufer könnten weiterhin den alten
	// Namen erwarten, also leiten wir um.
	function jaccard( a, b ) { return similarity( a, b ); }

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   6. Rendering
	//
	//   Rule: HTML is rendered. ##a i=… t=…## becomes a normal link.
	//   ALL other shortcodes are removed entirely (the editor compares text,
	//   not media/widgets — so video, contentad, gallery, embed, etc. simply
	//   disappear from view; they are still preserved 1:1 in the source and
	//   in the resolved output). Dangerous tags (script, iframe, …) are
	//   escaped, and on*-handlers / javascript:-URLs are stripped.
	// ────────────────────────────────────────────────────────────────────────────
	//

	//
	// WICHTIGE UNTERSCHEIDUNG — SOURCE vs DISPLAY
	// ────────────────────────────────────────────
	// In WinFuture-Artikeln ist alles legitimer Inhalt: <script>-Trackings,
	// onclick-Handler, <iframe>-Einbettungen, <form>/<input>/<button>/
	// <textarea>-Widgets, javascript:/data:-URLs. Der Widget-Output (das
	// was resolve_text() zurückgibt = row.before / row.after) MUSS exakt
	// das beinhalten, was der Redakteur eingegeben hat — Byte-für-Byte,
	// inklusive aller "gefährlichen" Konstrukte. Das Widget darf den
	// Artikelinhalt NIE verändern. Verifiziert durch die Byte-Exact-Tests.
	//
	// Beim DISPLAY (innerHTML der Cells im Modal) müssen wir aber das
	// Widget selbst schützen: würde <script> im DOM landen, würde der
	// Code im Kontext des Widgets ausgeführt werden; würde <a href=
	// "javascript:…"> klickbar gemacht, könnte ein versehentlicher Klick
	// vom Redakteur den Script ausführen. Wir wandeln solche Konstrukte
	// daher beim Render NUR FÜR DIE ANZEIGE in Klartext um (escape_html).
	// In der HTML-Code-Ansicht steht der Quelltext eh als Text da; in der
	// Lesbar-Ansicht erscheinen DANGEROUS_TAGS als sichtbare Text-Tokens —
	// der Redakteur sieht "<script>…</script>" und weiß: hier steckt
	// Tracking/Code drin.
	//
	// Die Liste ist BEWUSST KURZ: nur Tags, die beim Rendern ins DOM
	// aktiven Code ausführen oder den Container kapern können. <form>,
	// <input>, <button>, <textarea> sind KEIN Sicherheitsproblem für die
	// Anzeige — sie bleiben gerendert.
	//
	var DANGEROUS_TAGS = {
		'script': 1, 'style': 1, 'iframe': 1, 'object': 1, 'embed': 1,
		'frame': 1, 'frameset': 1, 'base': 1, 'link': 1, 'meta': 1,
		'applet': 1
	};

	// URL-Schemata, die beim Anklicken Code ausführen würden. Werden NUR
	// beim Rendern aus dem displayten Tag entfernt — der Original-Tag
	// (in row.before / row.after) bleibt mit allen Schemata intakt.
	var DANGEROUS_URL_RE = /(?:javascript|data|vbscript|file)\s*:/gi;

	function render_tag( tag ) {
		var name_match = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec( tag );
		if( !name_match ) { return escape_html( tag ); }
		var name = name_match[ 1 ].toLowerCase();
		if( DANGEROUS_TAGS[ name ] ) { return escape_html( tag ); }

		// Hinweis: alle Modifikationen ab hier wirken NUR auf die displayte
		// Kopie des Tags. Der Source-String, der in row.before / row.after
		// liegt und über resolve_text() zurückgegeben wird, ist davon
		// unberührt.
		var safe = tag
			.replace( /\son[a-z]+\s*=\s*"[^"]*"/gi, '' )
			.replace( /\son[a-z]+\s*=\s*'[^']*'/gi, '' )
			.replace( /\son[a-z]+\s*=\s*[^\s>]+/gi, '' )
			.replace( DANGEROUS_URL_RE, '' )
			.replace( /\sformaction\s*=\s*"[^"]*"/gi, '' )
			.replace( /\sformaction\s*=\s*'[^']*'/gi, '' )
			.replace( /\ssrcdoc\s*=\s*"[^"]*"/gi, '' )
			.replace( /\ssrcdoc\s*=\s*'[^']*'/gi, '' );
		// Alle <a href>-Links öffnen in einem neuen Fenster, damit das
		// Widget beim Klick auf eine Quelle nicht verschwindet. Existing
		// target/rel-Attribute werden vorher entfernt, damit wir die Kontrolle
		// behalten.
		if( name === 'a' && !/^<\//.test( safe ) ) {
			safe = safe
				.replace( /\starget\s*=\s*"[^"]*"/gi, '' )
				.replace( /\starget\s*=\s*'[^']*'/gi, '' )
				.replace( /\srel\s*=\s*"[^"]*"/gi, '' )
				.replace( /\srel\s*=\s*'[^']*'/gi, '' )
				.replace( /^<a\b/i, '<a target="_blank" rel="noopener noreferrer"' );
		}
		return safe;
	}

	// In Lesbar-Modus: ##a wird zu Link, alle anderen ##-Codes verschwinden.
	// In Quelltext-Modus: alle ##-Codes bleiben als Text sichtbar.
	function render_shortcode( raw, mode ) {
		if( mode === 'editor' ) { return escape_html( raw ); }
		var inner = raw.replace( /^##\s*|\s*##$/g, '' );
		var name_match = /^([a-zA-Z][a-zA-Z0-9_-]*)/.exec( inner );
		if( !name_match ) { return ''; }
		var name = name_match[ 1 ].toLowerCase();
		if( name !== 'a' ) { return ''; }
		var rest = inner.slice( name_match[ 1 ].length );
		var t_match = /\bt\s*=\s*"([^"]*)"/i.exec( rest ) || /\bt\s*=\s*'([^']*)'/i.exec( rest );
		var i_match = /\bi\s*=\s*"([^"]*)"/i.exec( rest ) || /\bi\s*=\s*'([^']*)'/i.exec( rest );
		var text = t_match ? t_match[ 1 ] : '';
		var id = i_match ? i_match[ 1 ] : '';
		if( !text ) { return ''; }
		return '<a href="#article-' + escape_html( id ) + '" class="vw-internal-link">' + escape_html( text ) + '</a>';
	}

	// In Quelltext-Modus: alles eskapen — HTML-Tags und ##-Codes erscheinen
	// als Roh-Text. In Lesbar-Modus: Tags werden weggeworfen, nur <a> und
	// <br> bleiben strukturell sichtbar; ##a## wird zu Link, andere
	// Shortcodes verschwinden.
	function render_token_html( token, mode ) {
		if( mode === 'editor' ) {
			// HTML+Shortcodes-Modus: kompletter Quelltext sichtbar, aber mit
			// Syntax-Highlighting wie ein Code-Editor.
			if( /^<\/?[a-zA-Z]/.test( token ) ) { return syntax_html_tag( token ); }
			if( /^##/.test( token ) ) { return syntax_shortcode( token ); }
			return escape_html( token );
		}

		if( /^<\/?[a-zA-Z]/.test( token ) ) {
			if( /^<br/i.test( token ) ) { return '<br>'; }
			if( /^<\/?\s*a\b/i.test( token ) ) { return render_tag( token ); }
			// Headings stay — they're rendered as bold inline in CSS so the
			// reader sees them as a clear subheading inside the paragraph row.
			if( /^<\/?\s*h[1-6]\b/i.test( token ) ) { return render_tag( token ); }
			// `<b>` und `<strong>` ebenfalls als Tag durchlassen, damit das
			// CSS sie im Lesbar-Modus fett rendert (übliche Überschriften-
			// Auszeichnung wie „Siehe auch:" oder Zwischen-Header).
			if( /^<\/?\s*(?:b|strong)\b/i.test( token ) ) { return render_tag( token ); }
			// Listen-Items im Lesbar-Modus mit Bullet + Einrückung. Der
			// führende `\n` sorgt dafür, dass jeder Punkt auf einer eigenen
			// Zeile beginnt, das `render_text_html`-Wrapping strippt das
			// leading newline am Anfang einer Cell wieder. Vier Leerzeichen
			// Indent macht die Liste optisch klar erkennbar.
			if( /^<li\b/i.test( token ) ) { return '\n    • '; }
			// All other tags: drop. Paragraph splitting handles block flow.
			return '';
		}
		if( /^##/.test( token ) ) { return render_shortcode( token, mode ); }
		return escape_html( token );
	}

	// Editor-Syntax: HTML-Tag aufbrechen in Brackets / Name / Attribute.
	function syntax_html_tag( tag ) {
		var m = /^(<\/?\s*)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\s*\/?>)$/.exec( tag );
		if( !m ) {
			return '<span class="vw-syn vw-syn-tag-bracket">' + escape_html( tag ) + '</span>';
		}
		var open = m[ 1 ], name = m[ 2 ], attrs = m[ 3 ], close = m[ 4 ];
		return ''
			+ '<span class="vw-syn vw-syn-tag-bracket">' + escape_html( open ) + '</span>'
			+ '<span class="vw-syn vw-syn-tag-name">' + escape_html( name ) + '</span>'
			+ syntax_attributes( attrs )
			+ '<span class="vw-syn vw-syn-tag-bracket">' + escape_html( close ) + '</span>';
	}

	// Editor-Syntax: ##name a="x" b="y"## farbig zerlegen.
	function syntax_shortcode( raw ) {
		var m = /^##\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*([\s\S]*?)\s*##$/.exec( raw );
		if( !m ) {
			return '<span class="vw-syn vw-syn-sc-mark">' + escape_html( raw ) + '</span>';
		}
		var name = m[ 1 ], attrs = m[ 2 ];
		var out = '<span class="vw-syn vw-syn-sc-mark">##</span>'
			+ '<span class="vw-syn vw-syn-sc-name">' + escape_html( name ) + '</span>';
		if( attrs ) {
			out += ' ' + syntax_attributes( attrs );
		}
		out += '<span class="vw-syn vw-syn-sc-mark">##</span>';
		return out;
	}

	// Parse attribute string into highlighted name=value pairs.
	// Handles double-quoted, single-quoted, and unquoted values. Detects
	// URL-like values (href/src or http(s)://) and colors them as links.
	function syntax_attributes( attrs ) {
		if( !attrs ) { return ''; }
		var attr_re = /([a-zA-Z_][a-zA-Z0-9_-]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
		var pos = 0, out = '', m;
		while( ( m = attr_re.exec( attrs ) ) !== null ) {
			if( m.index > pos ) { out += escape_html( attrs.slice( pos, m.index ) ); }
			var attr_name = m[ 1 ];
			out += '<span class="vw-syn vw-syn-attr">' + escape_html( attr_name ) + '</span>';
			if( m[ 2 ] ) {
				var value_str = m[ 3 ];
				var bare = value_str;
				if( value_str.charAt( 0 ) === '"' || value_str.charAt( 0 ) === "'" ) {
					bare = value_str.slice( 1, -1 );
				}
				var is_href = /^href$/i.test( attr_name );
				var is_url = is_href || /^(src|action|formaction|cite|poster)$/i.test( attr_name )
					|| /^https?:\/\//i.test( bare );
				var eq_str = m[ 2 ].slice( 0, m[ 2 ].indexOf( '=' ) + 1 );
				out += '<span class="vw-syn vw-syn-equals">' + escape_html( eq_str ) + '</span>';
				// href-Werte werden zu echten klickbaren Links (öffnen in
				// neuem Fenster), damit der Redakteur Quellen direkt prüfen
				// kann, ohne das Widget zu verlassen. Andere URL-artige
				// Attribute (src, …) bleiben rein farblich markiert.
				//
				// Sicherheit: jede href, die wir aktiv klickbar machen, muss
				// durch denselben Protokoll-Filter wie render_tag, sonst
				// könnte ein präparierter Eingabe-Text via javascript:/data:
				// Script ausführen, wenn der Nutzer klickt.
				if( is_href && bare && !DANGEROUS_URL_RE.test( bare ) ) {
					// reset the lastIndex – Regex hat das /g-Flag
					DANGEROUS_URL_RE.lastIndex = 0;
					out += '<a href="' + escape_html( bare ) + '" target="_blank" rel="noopener noreferrer" class="vw-syn vw-syn-url">'
						+ escape_html( value_str ) + '</a>';
				} else {
					DANGEROUS_URL_RE.lastIndex = 0;
					var value_class = is_url ? 'vw-syn vw-syn-url' : 'vw-syn vw-syn-string';
					out += '<span class="' + value_class + '">' + escape_html( value_str ) + '</span>';
				}
			}
			pos = m.index + m[ 0 ].length;
		}
		if( pos < attrs.length ) { out += escape_html( attrs.slice( pos ) ); }
		return out;
	}

	function render_text_html( text, mode ) {
		if( !text ) { return ''; }
		var toks = tokenize( text );
		var out = '';
		var lastWasHeadingClose = false;
		// `skipNextWs` lässt Whitespace direkt nach Listen-Strukturtags
		// (<ul>/<ol>-Opener, </li>) fallen — so entstehen im Lesbar-Modus
		// keine Leerzeilen zwischen Bullet-Items, die im Source nur durch
		// Source-Formatting (Newline-Einrückung) drinstecken.
		var skipNextWs = false;

		for( var i = 0; i < toks.length; i++ ) {
			var tk = toks[ i ];
			// Im Lesbar-Modus die Quelltext-Newlines, die UNMITTELBAR auf ein
			// </h1-6> folgen, wegwerfen. Sonst rendert pre-wrap eine Leerzeile
			// zwischen Zwischenüberschrift und Body — der Nutzer wollte
			// "nur ein Zeilenumbruch, wie in der HTML-Ansicht".
			if( mode === 'pseudo' && lastWasHeadingClose && /^\s+$/.test( tk ) ) {
				lastWasHeadingClose = false;
				continue;
			}

			if( mode === 'pseudo' && skipNextWs && /^\s+$/.test( tk ) ) {
				continue;
			}

			skipNextWs = false;
			out += render_token_html( tk, mode );

			lastWasHeadingClose = ( mode === 'pseudo' && /^<\/h[1-6]\b/i.test( tk ) );
			// Nach `<ul>`/`<ol>`-Opener UND nach `</li>` darf das nachfolgende
			// Source-Whitespace skipped werden — der nächste `<li>`-Marker
			// bringt seine eigene Newline mit, und ein leerer Trenner zwischen
			// Items wäre nur visuelles Rauschen.
			if( mode === 'pseudo' && ( /^<(?:ul|ol)\b/i.test( tk ) || /^<\/li>/i.test( tk ) ) ) {
				skipNextWs = true;
			}
		}

		// Leading Newlines wegnehmen — entsteht, wenn das erste Content-
		// Token des Paragraphs ein `<li>` ist (das rendert mit führendem
		// `\n` zur Trennung von Inhalt davor). Ohne diesen Strip hätte
		// jede Listen-Cell eine leere Zeile am Anfang.
		if( mode === 'pseudo' ) {
			out = out.replace( /^\n+/, '' );
		}

		return out;
	}

	// Render a single highlighted run of text. In Quelltext-Modus the whole
	// run goes into one wrap; in Lesbar-Modus, HTML tags and shortcodes are
	// emitted OUTSIDE the wrap so links / headings stay well-formed.
	function render_highlight_run( text, cls, mode ) {
		if( mode === 'editor' ) {
			// Apply syntax-highlighting INSIDE the diff wrapper so e.g. an
			// inserted <a href="…"> still renders with proper tag colors
			// but on a green background.
			return '<span class="' + cls + '">' + render_text_html( text, mode ) + '</span>';
		}
		var toks = tokenize( text );
		var parts = [];
		var buf = '';
		var flush = function() {
			if( buf.length === 0 ) { return; }
			parts.push( '<span class="' + cls + '">' + escape_html( buf ) + '</span>' );
			buf = '';
		};
		for( var i = 0; i < toks.length; i++ ) {
			var tok = toks[ i ];
			if( /^<\/?[a-zA-Z]/.test( tok ) || /^##/.test( tok ) ) {
				flush();
				var rendered = render_token_html( tok, mode );
				// Sonderfall: ein <a>-Opening-Tag in einem ins-/del-Lauf wird
				// als echter Link gerendert (außerhalb der diff-span, damit
				// die HTML-Balance erhalten bleibt). Dadurch wäre eine
				// hinzugefügte oder entfernte Verlinkung unsichtbar. Wir
				// hängen eine vw-link-ins/vw-link-del-Klasse an das <a>-Tag
				// an, sodass der Redakteur klar sieht: hier wurde gelinkt
				// bzw. der Link entfernt.
				if( /^<a\b/i.test( tok ) && /^<a\b/i.test( rendered ) ) {
					var marker = cls === 'vw-ins' ? 'vw-link-ins' : 'vw-link-del';
					if( /\sclass\s*=\s*"/i.test( rendered ) ) {
						rendered = rendered.replace( /(\sclass\s*=\s*")/i, '$1' + marker + ' ' );
					} else {
						rendered = rendered.replace( /^<a\b/i, '<a class="' + marker + '"' );
					}
				}
				parts.push( rendered );
			} else {
				buf += tok;
			}
		}
		flush();
		return parts.join( '' );
	}

	// Last-resort emptiness check: after rendering both sides for the current
	// mode, drop the row if there is no visible content to compare. This is
	// what catches paragraphs that are pure ##contentad##/##video## (which
	// render to empty in Lesbar-Modus and would otherwise appear as a blank
	// stripe between real paragraphs).
	function is_row_renderable( row, mode ) {
		var b = row.before_display || '';
		var a = row.after_display || '';
		function visible( s ) {
			if( !s ) { return ''; }
			var html = render_text_html( s, mode );
			return html.replace( /<[^>]+>/g, '' ).replace( /\s+/g, '' );
		}
		if( row.type === 'add' ) { return visible( a ).length > 0; }
		if( row.type === 'del' ) { return visible( b ).length > 0; }
		return visible( b ).length > 0 || visible( a ).length > 0;
	}

	// Render a paragraph cell with optional inline diff highlights.
	//
	// For mod-rows: when several adjacent words on one side are del (or ins)
	// AND the LCS aligned the spaces between them as eq, we MERGE those
	// runs across the whitespace into a single highlight. That produces ONE
	// continuous red/green bar over "Auswirkungen der schnell wachsenden …"
	// instead of word-sized boxes with gaps in the middle.
	function render_cell( text, side, ops, mode ) {
		if( !ops ) { return render_text_html( text, mode ); }

		var ourMark = side === 'before' ? 'del' : 'ins';

		// Pass 1: drop ops that belong to the OTHER side.
		var streamed = [];
		for( var i = 0; i < ops.length; i++ ) {
			var op = ops[ i ];
			if( op.op === 'eq' || op.op === ourMark ) { streamed.push( op ); }
		}

		// Pass 2: bridge ourMark runs across whitespace-only eq segments.
		var merged = [];
		var j = 0;
		while( j < streamed.length ) {
			if( streamed[ j ].op === ourMark ) {
				var run = streamed[ j ].text;
				var k = j + 1;
				while( k < streamed.length ) {
					if( streamed[ k ].op === ourMark ) {
						run += streamed[ k ].text; k++;
						continue;
					}
					if(
						streamed[ k ].op === 'eq'
						&& /^\s+$/.test( streamed[ k ].text )
						&& k + 1 < streamed.length
						&& streamed[ k + 1 ].op === ourMark
					) {
						run += streamed[ k ].text + streamed[ k + 1 ].text;
						k += 2;
						continue;
					}
					break;
				}
				merged.push( { op: ourMark, text: run } );
				j = k;
			} else {
				merged.push( streamed[ j ] );
				j++;
			}
		}

		// Pass 3: render. Im Lesbar-Modus werden del/ins-Tokens, die nur
		// aus Whitespace und/oder <br>/leeren Block-Tags bestehen, OHNE
		// rot/grünes Highlight ausgegeben — sie sind Layout-Rauschen,
		// keine textliche Entscheidung. Der Text bleibt aber auf seiner
		// Seite (Vorher behält sein \n\n, Nachher sein \n). Im HTML-Code-
		// Modus bleiben sie hervorgehoben, weil der Redakteur dort
		// bewusst den Quelltext prüft.
		var parts = [];
		for( var x = 0; x < merged.length; x++ ) {
			var mop = merged[ x ];

			if( mop.op === 'eq' ) {
				parts.push( render_text_html( mop.text, mode ) );
			} else if( mode === 'pseudo' && is_structural_only( mop.text ) ) {
				parts.push( render_text_html( mop.text, mode ) );
			} else {
				parts.push( render_highlight_run( mop.text, ourMark === 'del' ? 'vw-del' : 'vw-ins', mode ) );
			}
		}
		return parts.join( '' );
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   7. Resolve — assemble the final string from row decisions.
	//      Default for an undecided row is 'accept' (= the new version).
	// ────────────────────────────────────────────────────────────────────────────
	//

	// Resolve to a bundle of three strings: {headline, teaser, content}.
	// Each section is reconstructed from its own rows, so the caller can
	// drop the result straight into separate database fields or template
	// slots. Default for an undecided row is 'accept' (= the new version).
	function resolve_text( rows ) {
		var bundle = { headline: '', teaser: '', content: '' };
		for( var i = 0; i < rows.length; i++ ) {
			var row = rows[ i ];
			var key = row.section || 'content';
			if( !( key in bundle ) ) { key = 'content'; }
			// For eq rows we use row.after — bei nicht-whitespace-Equivalenz
			// ist das byte-gleich mit row.before, bei whitespace-only diffs
			// gewinnt damit der Nachher-Stil (siehe build_rows_from_paras).
			if( row.type === 'eq' ) {
				bundle[ key ] += row.after;
				continue;
			}
			var dec = row.decision || 'accept';
			bundle[ key ] += ( dec === 'accept' ? row.after : row.before );
		}
		return bundle;
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   8. Widget instance
	// ────────────────────────────────────────────────────────────────────────────
	//

	function Widget( opts ) {
		this.opts = opts;
		this.title = opts.title || 'Unterschiede';
		this.mode = opts.defaultMode === 'editor' ? 'editor' : 'pseudo';
		this.only_changes = opts.defaultOnlyChanges !== false; // default ON
		this.search = '';
		this.active_index = 0;

		// Remember whether the caller passed strings (legacy) or bundles so
		// we can return the same shape via onResolve.
		this.input_is_bundle = ( opts.before && typeof opts.before === 'object' )
			|| ( opts.after && typeof opts.after === 'object' );
		this.rows = build_rows( opts.before || '', opts.after || '' );
	}

	Widget.prototype.openable_rows = function() {
		return this.rows.filter( function( r ) { return r.type !== 'eq'; } );
	};
	Widget.prototype.pending_rows = function() {
		return this.rows.filter( function( r ) { return r.type !== 'eq' && !r.decision; } );
	};

	Widget.prototype.open = function() {
		inject_css();
		this.root = document.createElement( 'div' );
		this.root.className = 'vw-overlay';
		this.root.innerHTML = this.shell_html();
		document.body.appendChild( this.root );

		// Hintergrund-Scroll sperren, solange das Modal offen ist —
		// damit der Editor beim Scrollen im Diff nicht versehentlich die
		// darunterliegende CMS-Seite mitscrollt. Den vorherigen Overflow-
		// Wert merken und beim Schließen wiederherstellen, damit wir den
		// CMS-Editor-Status nicht überschreiben.
		this._prev_body_overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		this.cache_dom();
		this.bind_events();
		this.render();

		this.modal.tabIndex = -1;
		this.modal.focus();
	};

	// Footer-Button hat zwei States, die durch das Decision-Profil bestimmt
	// werden:
	//   * Solange kein Row auf 'reject' steht → grüner "Alle annehmen"-Button.
	//     Beim Klick werden alle Rows zwangsweise auf 'accept' gesetzt und
	//     das Modal mit Fade-out geschlossen.
	//   * Sobald mind. ein Row auf 'reject' steht → grauer "Übernehmen"-Button.
	//     Beim Klick werden die User-Entscheidungen unverändert übernommen,
	//     Modal-Animation läuft identisch.
	Widget.prototype.trigger_footer_action = function() {
		if( !this.root ) { return; }
		var has_reject = this.rows.some( function( r ) { return r.decision === 'reject'; } );

		if( !has_reject ) {
			for( var i = 0; i < this.rows.length; i++ ) {
				this.rows[ i ].decision = 'accept';
			}
			this.flash_all_accepted();
		}
		this.close_animated();
	};

	// Sofortiges DOM-Update: alle ×/✓-Buttons und Row-Akzente auf "angenommen"
	// setzen, ohne ein volles re-render zu triggern (das würde im laufenden
	// Fade-out neue Zellen anlegen und die Animation stören). Macht die
	// Akzeptanz für den Redakteur kurz visuell sichtbar, während das Modal
	// schon im Hintergrund verschwindet.
	Widget.prototype.flash_all_accepted = function() {
		if( !this.root ) { return; }

		var rejectedCells = this.root.querySelectorAll( '.vw-cell.vw-row-rejected' );
		for( var i = 0; i < rejectedCells.length; i++ ) {
			rejectedCells[ i ].classList.remove( 'vw-row-rejected' );
			rejectedCells[ i ].classList.add( 'vw-row-resolved' );
		}

		var rejectBtns = this.root.querySelectorAll( '.vw-actions-btn.vw-reject.vw-on-reject' );
		for( var j = 0; j < rejectBtns.length; j++ ) {
			rejectBtns[ j ].classList.remove( 'vw-on-reject' );
		}

		var acceptBtns = this.root.querySelectorAll( '.vw-actions-btn.vw-accept' );
		for( var k = 0; k < acceptBtns.length; k++ ) {
			acceptBtns[ k ].classList.add( 'vw-on-accept' );
		}
	};

	// Schließt das Modal mit kurzer Fade-out-Animation. Die CSS-Transition
	// läuft 180ms; nach Ablauf wird close() aufgerufen, das das DOM entfernt
	// und onResolve/onClose triggert.
	Widget.prototype.close_animated = function() {
		if( !this.root ) { return; }
		this.root.classList.add( 'vw-closing' );
		var self = this;
		setTimeout( function() { self.close(); }, 180 );
	};

	// Footer-Button live an das Decision-Profil anpassen: Label wechselt
	// zwischen "Alle annehmen" und "Übernehmen", die Optik bleibt gleich
	// (grün) — der Button ist immer die Primary Action.
	Widget.prototype.update_footer_action = function() {
		if( !this.root ) { return; }
		var btn = this.root.querySelector( '[data-vw-footer-action]' );

		if( !btn ) { return; }

		var has_reject = this.rows.some( function( r ) { return r.decision === 'reject'; } );

		if( has_reject ) {
			btn.innerHTML = 'Übernehmen';
			btn.title = 'Mit den aktuellen ✓/×-Entscheidungen übernehmen';
		} else {
			btn.innerHTML = '✓ Alle annehmen';
			btn.title = 'Alle offenen Entscheidungen annehmen und schließen';
		}
	};

	Widget.prototype.close = function() {
		if( !this.root ) { return; }
		var bundle = resolve_text( this.rows );
		// If the caller gave us strings, hand back a single string for
		// backward compatibility. If they gave a bundle, return a bundle.
		var resolved = this.input_is_bundle
			? bundle
			: ( bundle.headline + bundle.teaser + bundle.content );
		var stats = {
			total: this.openable_rows().length,
			accepted: this.rows.filter( function( r ) { return r.decision === 'accept'; } ).length,
			rejected: this.rows.filter( function( r ) { return r.decision === 'reject'; } ).length
		};
		document.removeEventListener( 'keydown', this.key_handler, true );
		this.root.remove();
		this.root = null;
		// Body-Overflow auf den vorherigen Wert zurücksetzen.
		document.body.style.overflow = this._prev_body_overflow || '';
		if( typeof this.opts.onResolve === 'function' ) {
			try { this.opts.onResolve( resolved, stats ); } catch( e ) { /* noop */ }
		}
		if( typeof this.opts.onClose === 'function' ) {
			try { this.opts.onClose(); } catch( e ) { /* noop */ }
		}
	};

	Widget.prototype.shell_html = function() {
		return ''
			+ '<div class="vw-modal" role="dialog" aria-modal="true" aria-label="' + escape_html( this.title ) + '">'
			+ ' <div class="vw-header">'
			+ '   <div class="vw-title">' + escape_html( this.title ) + '</div>'
			+ '   <div class="vw-segmented" role="tablist" aria-label="Ansichtsmodus">'
			+ '     <button type="button" class="' + ( this.mode === 'editor' ? 'vw-active' : '' ) + '" data-vw-mode="editor" title="Quelltext-Ansicht (mit HTML &amp; ##-Codes)">HTML-Code</button>'
			+ '     <button type="button" class="' + ( this.mode === 'pseudo' ? 'vw-active' : '' ) + '" data-vw-mode="pseudo" title="Reine Textansicht (HTML &amp; ##-Codes ausgeblendet, Links bleiben)">Nur Text</button>'
			+ '   </div>'
			+ '   <label class="vw-checkbox"><input type="checkbox" data-vw-only' + ( this.only_changes ? ' checked' : '' ) + '> Nur Änderungen</label>'
			+ '   <span class="vw-grow"></span>'
			+ '   <span class="vw-nav">'
			+ '     <button type="button" class="vw-icon-btn" data-vw-prev title="Vorheriger Absatz mit Änderung (P)">'
			+ '       <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 8l3-3 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
			+ '     </button>'
			+ '     <span class="vw-counter" data-vw-counter>0 / 0</span>'
			+ '     <button type="button" class="vw-icon-btn" data-vw-next title="Nächster Absatz mit Änderung (N)">'
			+ '       <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
			+ '     </button>'
			+ '   </span>'
			+ '   <span class="vw-search">'
			+ '     <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M7.5 7.5l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
			+ '     <input type="text" placeholder="Suchen…" data-vw-search>'
			+ '   </span>'
			+ '   <button type="button" class="vw-close" data-vw-close>× Schließen</button>'
			+ ' </div>'
			+ ' <div class="vw-body" data-vw-body>'
			+ '   <div class="vw-grid" data-vw-grid>'
			+ '     <div class="vw-cell vw-cell-before vw-pane-label" style="font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:#f8f9fb;border-bottom-color:#e5e7eb;padding:8px 18px;">Vorher</div>'
			+ '     <div class="vw-cell vw-cell-after vw-pane-label" style="font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:#f8f9fb;border-bottom-color:#e5e7eb;padding:8px 18px;">Nachher</div>'
			+ '     <div class="vw-cell vw-cell-actions" style="background:#f8f9fb;border-bottom-color:#e5e7eb;padding:8px 4px;"></div>'
			+ '   </div>'
			+ ' </div>'
			+ ' <div class="vw-footer">'
			+ '   <span class="vw-legend">'
			+ '     <span class="vw-legend-label">Legende</span>'
			+ '     <span class="vw-legend-tag vw-del">entfernt</span>'
			+ '     <span class="vw-legend-tag vw-ins">hinzugefügt</span>'
			+ '   </span>'
			+ keys_footer_html()
			+ '   <span class="vw-grow"></span>'
			+ '   <button type="button" class="vw-footer-action" data-vw-footer-action title="Alle offenen Entscheidungen annehmen und schließen">✓ Alle annehmen</button>'
			+ ' </div>'
			+ '</div>';
	};

	Widget.prototype.cache_dom = function() {
		var $ = function( sel ) { return this.root.querySelector( sel ); }.bind( this );
		this.modal = $( '.vw-modal' );
		this.body = $( '[data-vw-body]' );
		this.grid = $( '[data-vw-grid]' );
		this.counter_el = $( '[data-vw-counter]' );
		this.search_input = $( '[data-vw-search]' );
		this.only_checkbox = $( '[data-vw-only]' );
	};

	Widget.prototype.bind_events = function() {
		var self = this;

		this.root.addEventListener( 'click', function( ev ) {
			var t = ev.target;
			if( t.closest && t.closest( '[data-vw-close]' ) ) { self.close(); return; }
			if( t.closest && t.closest( '[data-vw-footer-action]' ) ) { self.trigger_footer_action(); return; }
			if( t.closest && t.closest( '[data-vw-prev]' ) ) { self.navigate( -1 ); return; }
			if( t.closest && t.closest( '[data-vw-next]' ) ) { self.navigate( 1 ); return; }
			var modeBtn = t.closest && t.closest( '[data-vw-mode]' );
			if( modeBtn ) {
				self.mode = modeBtn.getAttribute( 'data-vw-mode' );
				self.render();
				return;
			}
			var actionBtn = t.closest && t.closest( '[data-vw-action]' );
			if( actionBtn ) {
				var id = parseInt( actionBtn.getAttribute( 'data-vw-row' ), 10 );
				self.decide( id, actionBtn.getAttribute( 'data-vw-action' ) );
			}
		} );

		this.root.addEventListener( 'mousedown', function( ev ) {
			if( ev.target === self.root ) { self.close(); }
		} );

		this.only_checkbox.addEventListener( 'change', function() {
			self.only_changes = self.only_checkbox.checked;
			self.render();
		} );

		// Inline-Edit auf der Nachher-Seite ist absichtlich nicht
		// implementiert — der Lesbar-Modus rendert das Markup nicht,
		// daher würde ein `innerText`-Sync den Source verlieren. Links
		// in den read-only Cells folgen ihrem `target="_blank"` aus dem
		// Renderer ganz normal über den Browser-Default; kein extra
		// Click-Handler nötig.

		this.search_input.addEventListener( 'input', function() {
			self.search = self.search_input.value;
			self.apply_search();
		} );

		this.key_handler = function( ev ) {
			if( !self.root ) { return; }
			// Wenn ein Inline-Edit-Feld oder die Suchbox fokussiert ist, sollen
			// die Widget-Shortcuts nicht feuern (sonst würde z. B. Space im
			// Editor "annehmen" auslösen). Escape verlässt nur das Eingabefeld,
			// schließt aber NICHT das Widget — sonst würde Escape im Editor
			// die ganze Bearbeitung wegwerfen.
			var t = ev.target;
			if( t === self.search_input || ( t && t.isContentEditable ) ) {
				if( ev.key === 'Escape' ) {
					ev.preventDefault();
					t.blur();
					self.modal.focus();
				}
				return;
			}
			if( ev.key === 'Escape' ) { ev.preventDefault(); self.close(); }
			// ↑ / ↓ navigieren durch die Zeilen.
			else if( ev.key === 'ArrowDown' ) { ev.preventDefault(); self.navigate( 1 ); }
			else if( ev.key === 'ArrowUp' ) { ev.preventDefault(); self.navigate( -1 ); }
			// → = annehmen (Toggle bei Wiederwahl).
			else if( ev.key === 'ArrowRight' ) { ev.preventDefault(); self.decide_active( 'accept' ); }
			// ← = ablehnen (Toggle bei Wiederwahl).
			else if( ev.key === 'ArrowLeft' ) { ev.preventDefault(); self.decide_active( 'reject' ); }
			// Enter = Footer-Button auslösen (Alle annehmen oder Übernehmen,
			// je nach aktuellem Decision-State).
			else if( ev.key === 'Enter' ) { ev.preventDefault(); self.trigger_footer_action(); }
		};
		document.addEventListener( 'keydown', this.key_handler, true );
	};

	Widget.prototype.render = function() {
		this.modal.classList.toggle( 'vw-mode-editor', this.mode === 'editor' );
		this.modal.classList.toggle( 'vw-mode-pseudo', this.mode === 'pseudo' );
		this.root.querySelectorAll( '[data-vw-mode]' ).forEach( function( b ) {
			b.classList.toggle( 'vw-active', b.getAttribute( 'data-vw-mode' ) === this.mode );
		}.bind( this ) );

		// Remove old row cells, keep header cells
		var grid = this.grid;
		var children = Array.prototype.slice.call( grid.children );
		// First three cells are the header row (Vorher/Nachher/Buttons label)
		for( var i = 3; i < children.length; i++ ) { grid.removeChild( children[ i ] ); }

		var visible_rows = this.visible_rows();
		var html = '';
		for( var k = 0; k < visible_rows.length; k++ ) {
			html += this.row_html( visible_rows[ k ] );
		}
		// Use a temporary container to parse, then move cells into the grid
		var tmp = document.createElement( 'div' );
		tmp.innerHTML = '<div class="vw-grid" style="display:contents">' + html + '</div>';
		var inner = tmp.firstElementChild;
		while( inner.firstChild ) { grid.appendChild( inner.firstChild ); }

		this.update_counter();
		this.update_footer_action();
		this.apply_search();
		this.highlight_active();
	};

	Widget.prototype.row_html = function( row ) {
		var beforeHtml, afterHtml, actionsHtml;
		var rowCls = 'vw-row vw-row-' + row.type;
		if( row.section ) { rowCls += ' vw-row-' + row.section; }
		if( row.section_start ) { rowCls += ' vw-section-start'; }
		if( row.decision === 'accept' ) { rowCls += ' vw-row-resolved'; }
		else if( row.decision === 'reject' ) { rowCls += ' vw-row-rejected'; }

		var mode = this.mode;
		if( row.type === 'eq' ) {
			beforeHtml = render_cell( row.before_display, 'before', null, mode );
			afterHtml = render_cell( row.after_display, 'after', null, mode );
			actionsHtml = '';
		} else if( row.type === 'mod' ) {
			beforeHtml = render_cell( row.before_display, 'before', row.inner_ops, mode );
			afterHtml = render_cell( row.after_display, 'after', row.inner_ops, mode );
			actionsHtml = this.actions_html( row );
		} else if( row.type === 'add' ) {
			beforeHtml = '<span class="vw-empty">— neu hinzugefügt —</span>';
			afterHtml = '<span class="vw-ins">' + render_cell( row.after_display, 'after', null, mode ) + '</span>';
			actionsHtml = this.actions_html( row );
		} else if( row.type === 'del' ) {
			beforeHtml = '<span class="vw-del">' + render_cell( row.before_display, 'before', null, mode ) + '</span>';
			afterHtml = '<span class="vw-empty">— entfernt —</span>';
			actionsHtml = this.actions_html( row );
		}

		// Beide Zellen sind read-only. Inline-Edit auf der Nachher-Seite
		// war früher per `contenteditable="plaintext-only"` möglich, hat
		// aber im Lesbar-Modus (HTML-Tags und ##-Shortcodes sind dort
		// versteckt) den Source-Markup beim `innerText`-Sync verloren —
		// Heilige-Kuh-Verletzung (siehe Sektion 3 in CLAUDE.md). Wer den
		// Nachher-Text noch ändern will, tut das nach dem Resolve direkt
		// im Editor.
		return ''
			+ '<div class="vw-cell vw-cell-before ' + rowCls + '" data-vw-row-id="' + row.id + '">' + beforeHtml + '</div>'
			+ '<div class="vw-cell vw-cell-after ' + rowCls + '" data-vw-row-id="' + row.id + '">' + afterHtml + '</div>'
			+ '<div class="vw-cell vw-cell-actions ' + rowCls + '" data-vw-row-id="' + row.id + '">' + actionsHtml + '</div>';
	};

	Widget.prototype.actions_html = function( row ) {
		var rejCls = row.decision === 'reject' ? ' vw-on-reject' : '';
		var accCls = row.decision === 'accept' ? ' vw-on-accept' : '';
		return ''
			+ '<button type="button" class="vw-actions-btn vw-reject' + rejCls + '" data-vw-action="reject" data-vw-row="' + row.id + '" title="Vorher behalten">×</button>'
			+ '<button type="button" class="vw-actions-btn vw-accept' + accCls + '" data-vw-action="accept" data-vw-row="' + row.id + '" title="Nachher übernehmen">✓</button>';
	};

	// Rows the user can step through with the keyboard. Always = openable
	// rows that are actually VISIBLE in the current mode. When "Nur Änderungen"
	// is on, that's just mod/add/del. When it's off, also the same — eq rows
	// are skipped because there's nothing to decide on them. This keeps a
	// stable, predictable navigation experience across both filter states.
	Widget.prototype.nav_rows = function() {
		var visible = this.visible_rows();
		return visible.filter( function( r ) { return r.type !== 'eq'; } );
	};

	Widget.prototype.visible_rows = function() {
		return this.rows.filter( function( r ) {
			if( this.only_changes && r.type === 'eq' ) { return false; }
			return is_row_renderable( r, this.mode );
		}.bind( this ) );
	};

	Widget.prototype.update_counter = function() {
		var nav = this.nav_rows();
		if( nav.length === 0 ) { this.counter_el.textContent = '0 / 0'; return; }
		if( this.active_index >= nav.length ) { this.active_index = 0; }
		var pending = this.pending_rows().length;
		var label = ( this.active_index + 1 ) + ' / ' + nav.length;
		if( pending === 0 ) { label += ' · fertig'; }
		else if( pending < nav.length ) { label += ' · ' + pending + ' offen'; }
		this.counter_el.textContent = label;
	};

	Widget.prototype.navigate = function( dir ) {
		var nav = this.nav_rows();
		if( nav.length === 0 ) { return; }
		this.active_index = ( this.active_index + dir + nav.length ) % nav.length;
		this.update_counter();
		this.highlight_active( true );
	};

	Widget.prototype.active_row_id = function() {
		var nav = this.nav_rows();
		if( nav.length === 0 ) { return null; }
		return nav[ this.active_index ].id;
	};

	Widget.prototype.highlight_active = function( scroll ) {
		var rid = this.active_row_id();
		this.grid.querySelectorAll( '.vw-row-active' ).forEach( function( el ) {
			el.classList.remove( 'vw-row-active' );
		} );
		if( rid == null ) { return; }
		var els = this.grid.querySelectorAll( '[data-vw-row-id="' + rid + '"]' );
		els.forEach( function( el ) { el.classList.add( 'vw-row-active' ); } );
		if( scroll && els.length > 0 ) {
			els[ 0 ].scrollIntoView( { block: 'center', behavior: 'smooth' } );
		}
	};

	Widget.prototype.decide = function( rowId, action ) {
		var row = null;
		for( var i = 0; i < this.rows.length; i++ ) {
			if( this.rows[ i ].id === rowId ) { row = this.rows[ i ]; break; }
		}
		if( !row ) { return; }
		// Toggle off if same decision again
		if( row.decision === action ) { row.decision = null; }
		else { row.decision = action; }
		this.render();
	};

	Widget.prototype.decide_active = function( action ) {
		var id = this.active_row_id();
		if( id == null ) { return; }
		this.decide( id, action );
	};

	Widget.prototype.apply_search = function() {
		var q = this.search.trim().toLowerCase();
		this.grid.querySelectorAll( '.vw-search-hit' ).forEach( function( el ) {
			el.outerHTML = el.innerHTML;
		} );
		if( !q ) { return; }
		var cells = this.grid.querySelectorAll( '.vw-cell-before, .vw-cell-after' );
		cells.forEach( function( cell ) { highlight_text_matches( cell, q ); } );
	};

	function highlight_text_matches( root, query ) {
		var walker = document.createTreeWalker( root, NodeFilter.SHOW_TEXT, null );
		var nodes = [];
		var n;
		while( ( n = walker.nextNode() ) ) { nodes.push( n ); }
		nodes.forEach( function( textNode ) {
			var lower = textNode.nodeValue.toLowerCase();
			var idx = lower.indexOf( query );
			if( idx === -1 ) { return; }
			var frag = document.createDocumentFragment();
			var rest = textNode.nodeValue;
			while( idx !== -1 ) {
				if( idx > 0 ) { frag.appendChild( document.createTextNode( rest.slice( 0, idx ) ) ); }
				var hit = document.createElement( 'span' );
				hit.className = 'vw-search-hit';
				hit.textContent = rest.slice( idx, idx + query.length );
				frag.appendChild( hit );
				rest = rest.slice( idx + query.length );
				lower = rest.toLowerCase();
				idx = lower.indexOf( query );
			}
			if( rest.length > 0 ) { frag.appendChild( document.createTextNode( rest ) ); }
			textNode.parentNode.replaceChild( frag, textNode );
		} );
	}

	//
	// ────────────────────────────────────────────────────────────────────────────
	//   9. Public API
	// ────────────────────────────────────────────────────────────────────────────
	//

	var api = {
		open: function( opts ) {
			var w = new Widget( opts || {} );
			w.open();
			return w;
		},
		_internal: {
			tokenize: tokenize,
			diff_tokens: diff_tokens,
			split_paragraphs: split_paragraphs,
			build_rows: build_rows,
			resolve_text: resolve_text,
			render_text_html: render_text_html
		}
	};

	global.VergleichsWidget = api;
	if( typeof module !== 'undefined' && module.exports ) { module.exports = api; }

}( typeof window !== 'undefined' ? window : globalThis ) );
