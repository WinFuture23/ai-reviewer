<?php
/**
 * AI-Reviewer integration for the WinFuture editorial system.
 *
 * Renders the auth token and script tag for the AI reviewer widget.
 * Must only be included for authenticated editors.
 *
 * Usage:
 *   wfv4_ai_reviewer::render( $secret );
 *
 * The secret must match the AI_REVIEWER_SECRET configured in the
 * Val.town proxy (environment variable).
 *
 * @author mesios
 * @version 1 2026-03-06
 */
class wfv4_ai_reviewer {

	/**
	 * @var string CDN_URL Script source URL
	 */
	const CDN_URL = 'https://winfuture23.github.io/ai-reviewer/ai-reviewer.js';

	/**
	 * Generates an HMAC-SHA256 auth token and renders both the
	 * token injection and the script tag.
	 *
	 * @author mesios
	 * @version 1 2026-03-06
	 * @param string $secret shared HMAC secret (min 32 chars)
	 * @return void
	 */
	public static function render( $secret ) {

		/*
		 * @var int $timestamp current unix timestamp
		 */
		$timestamp = time();

		/*
		 * @var string $token HMAC-SHA256 hex digest
		 */
		$token = hash_hmac( 'sha256', (string)$timestamp, $secret );

?><script>
window.wfv4_ai_reviewer_auth={token:"<?= htmlspecialchars( $token, ENT_QUOTES, 'UTF-8' ) ?>",ts:<?= (int)$timestamp ?>};
</script>
<script src="<?= self::CDN_URL ?>?v=<?= $timestamp ?>"></script>
<?php
	}
}
