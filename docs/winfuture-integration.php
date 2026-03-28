<?php
/**
 * AI-Reviewer integration for the WinFuture editorial system.
 *
 * Renders the auth token and script tag for the AI reviewer widget.
 * Must only be included for authenticated editors.
 *
 * Usage:
 *   wfv4_ai_reviewer::render( $secret, $content_type, $content_id );
 *
 * The secret must match the AI_REVIEWER_SECRET configured in the
 * Val.town proxy (environment variable).
 *
 * The HMAC includes content_type and content_id to prevent token
 * reuse across different articles (Sicherheitsrichtlinie §7/§11).
 *
 * @author mesios
 * @version 2 2026-03-19
 */
class wfv4_ai_reviewer {

	/**
	 * @var string CDN_URL Script source URL
	 */
	const CDN_URL = 'https://winfuture23.github.io/ai-reviewer/ai-reviewer.js';

	/**
	 * @var array ALLOWED_TYPES whitelist of valid content type IDs (§18)
	 */
	const ALLOWED_TYPES = [1, 5, 6, 8];

	/**
	 * Generates an HMAC-SHA256 auth token bound to the specific article
	 * and renders the token injection and script tag.
	 *
	 * HMAC payload: "{timestamp}|{content_type}|{content_id}"
	 * This ensures the token is only valid for this specific article.
	 *
	 * @author mesios
	 * @version 2 2026-03-19
	 * @param string $secret shared HMAC secret (min 32 chars)
	 * @param int $content_type content type ID (1=FAQ, 5=Video, 6=News, 8=Download)
	 * @param int $content_id article ID in the CMS
	 * @return void
	 */
	public static function render( $secret, $content_type, $content_id ) {

		// Sicherheitsrichtlinie §19: Ungueltige Eingaben abweisen, nicht korrigieren
		// Sicherheitsrichtlinie §12: Keine Details in Fehlermeldungen an den Client
		if( !is_numeric( $content_type ) || !in_array( (int)$content_type, self::ALLOWED_TYPES, true ) ) {
			trigger_error( 'wfv4_ai_reviewer::render() - invalid content_type', E_USER_WARNING );
			return;
		}

		if( !is_numeric( $content_id ) || (int)$content_id < 0 ) {
			trigger_error( 'wfv4_ai_reviewer::render() - invalid content_id', E_USER_WARNING );
			return;
		}

		/*
		 * @var int $timestamp current unix timestamp
		 */
		$timestamp = time();

		/*
		 * @var string $hmac_payload timestamp|content_type|content_id
		 */
		$hmac_payload = $timestamp . '|' . (int)$content_type . '|' . (int)$content_id;

		/*
		 * @var string $token HMAC-SHA256 hex digest
		 */
		$token = hash_hmac( 'sha256', $hmac_payload, $secret );

?><script>
window.wfv4_ai_reviewer_auth={token:"<?= htmlspecialchars( $token, ENT_QUOTES, 'UTF-8' ) ?>",ts:<?= (int)$timestamp ?>};
</script>
<script src="<?= self::CDN_URL ?>?v=<?= $timestamp ?>"></script>
<?php
	}
}
