<?php
/**
 * Plugin Name:       ICD-10 Codex — Customer Care & License
 * Plugin URI:        https://ruangpmik.id/
 * Description:       Chatbot Customer Care (tiket email) + endpoint verifikasi kode lisensi Mayar untuk ICD-10 Codex 2010.
 * Version:           1.0.0
 * Author:            RUANGPMIK
 * Author URI:        https://ruangpmik.id/
 * License:           GPL-2.0-or-later
 * Text Domain:       icd10-care
 *
 * Cara pakai:
 *   1. Aktifkan plugin, buka Settings > ICD-10 Care, isi API Key + Product ID Mayar.
 *   2. Halaman Customer Care: sisipkan shortcode [icd10_care].
 *   3. Halaman Checkout: sisipkan shortcode [icd10_checkout].
 *   4. Endpoint lisensi otomatis tersedia di /wp-json/icd10/v1/license/verify
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'ICD10CARE_VER', '1.0.0' );
define( 'ICD10CARE_NS', 'icd10/v1' );
define( 'ICD10CARE_DEFAULT_EMAIL', 'ruangpmik@gmail.com' );

require_once __DIR__ . '/includes/checkout.php';

/* =========================================================================
 * PENGATURAN (Settings > ICD-10 Care)
 * ========================================================================= */

function icd10care_defaults() {
	return array(
		'mayar_api_key'    => '',
		'mayar_product_id' => '',
		'support_email'    => ICD10CARE_DEFAULT_EMAIL,
		'support_link'     => 'https://ruangpmik.myr.id/support',
		'checkout_amount'  => 49000,
		'checkout_desc'    => 'ICD-10 Codex 2010 — lisensi',
		'download_url'     => 'https://ruangpmik.myr.id/app/icd-10-codex-2010',
		'webhook_secret'   => '',
	);
}

function icd10care_opt( $key = null ) {
	$o = wp_parse_args( (array) get_option( 'icd10care_settings', array() ), icd10care_defaults() );
	if ( null === $key ) { return $o; }
	return isset( $o[ $key ] ) ? $o[ $key ] : '';
}

add_action( 'admin_menu', function () {
	add_options_page( 'ICD-10 Care', 'ICD-10 Care', 'manage_options', 'icd10-care', 'icd10care_settings_page' );
} );

add_action( 'admin_init', function () {
	register_setting( 'icd10care', 'icd10care_settings', array(
		'type'              => 'array',
		'sanitize_callback' => 'icd10care_sanitize_settings',
		'default'           => icd10care_defaults(),
	) );
} );

function icd10care_sanitize_settings( $in ) {
	$in = (array) $in;
	$out = icd10care_defaults();
	if ( isset( $in['mayar_api_key'] ) )    { $out['mayar_api_key'] = trim( sanitize_text_field( $in['mayar_api_key'] ) ); }
	if ( isset( $in['mayar_product_id'] ) ) { $out['mayar_product_id'] = trim( sanitize_text_field( $in['mayar_product_id'] ) ); }
	if ( isset( $in['support_email'] ) && is_email( $in['support_email'] ) ) { $out['support_email'] = sanitize_email( $in['support_email'] ); }
	if ( isset( $in['support_link'] ) )     { $out['support_link'] = esc_url_raw( $in['support_link'] ); }
	if ( isset( $in['checkout_amount'] ) )  { $out['checkout_amount'] = max( 1, (int) $in['checkout_amount'] ); }
	if ( isset( $in['checkout_desc'] ) )    { $out['checkout_desc'] = sanitize_text_field( $in['checkout_desc'] ); }
	if ( isset( $in['download_url'] ) )     { $out['download_url'] = esc_url_raw( $in['download_url'] ); }
	if ( isset( $in['webhook_secret'] ) && $in['webhook_secret'] !== '' ) {
		$out['webhook_secret'] = preg_replace( '/[^A-Za-z0-9]/', '', (string) $in['webhook_secret'] );
	}
	if ( $out['webhook_secret'] === '' ) {
		$out['webhook_secret'] = wp_generate_password( 40, false, false );
	}
	return $out;
}

function icd10care_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$o   = icd10care_opt();
	$url = rest_url( ICD10CARE_NS . '/license/verify' );
	?>
	<div class="wrap">
		<h1>ICD-10 Codex — Customer Care &amp; License</h1>
		<p>Shortcode chatbot: <code>[icd10_care]</code> · Shortcode checkout: <code>[icd10_checkout]</code></p>
		<p>Endpoint verifikasi lisensi: <code><?php echo esc_html( $url ); ?></code></p>
		<form method="post" action="options.php">
			<?php settings_fields( 'icd10care' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="icd10care_mayar_key">Mayar API Key (Read &amp; Write)</label></th>
					<td>
						<input type="password" id="icd10care_mayar_key" name="icd10care_settings[mayar_api_key]"
							value="<?php echo esc_attr( $o['mayar_api_key'] ); ?>" class="regular-text" autocomplete="off" />
						<p class="description">Ambil di <a href="https://web.mayar.id/api-keys" target="_blank" rel="noopener">web.mayar.id/api-keys</a>. Jangan sebarkan.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_mayar_pid">Mayar Product ID</label></th>
					<td>
						<input type="text" id="icd10care_mayar_pid" name="icd10care_settings[mayar_product_id]"
							value="<?php echo esc_attr( $o['mayar_product_id'] ); ?>" class="regular-text" />
						<p class="description">UUID produk lisensi (dari URL detail produk Mayar).</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_support_email">Email tiket CS</label></th>
					<td><input type="email" id="icd10care_support_email" name="icd10care_settings[support_email]"
							value="<?php echo esc_attr( $o['support_email'] ); ?>" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_support_link">Link dukungan / donasi</label></th>
					<td><input type="url" id="icd10care_support_link" name="icd10care_settings[support_link]"
							value="<?php echo esc_attr( $o['support_link'] ); ?>" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_amount">Harga checkout (Rp)</label></th>
					<td><input type="number" min="1" id="icd10care_amount" name="icd10care_settings[checkout_amount]"
							value="<?php echo esc_attr( $o['checkout_amount'] ); ?>" class="small-text" />
						<p class="description">Harga milik server. Tidak diambil dari permintaan pembeli.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_desc">Deskripsi item invoice</label></th>
					<td><input type="text" id="icd10care_desc" name="icd10care_settings[checkout_desc]"
							value="<?php echo esc_attr( $o['checkout_desc'] ); ?>" class="regular-text" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_download">URL unduh installer</label></th>
					<td><input type="url" id="icd10care_download" name="icd10care_settings[download_url]"
							value="<?php echo esc_attr( $o['download_url'] ); ?>" class="regular-text" />
						<p class="description">Dikirim ke pembeli di email setelah pembayaran lunas.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="icd10care_secret">Webhook secret</label></th>
					<td><input type="text" id="icd10care_secret" name="icd10care_settings[webhook_secret]"
							value="<?php echo esc_attr( $o['webhook_secret'] ); ?>" class="regular-text code" />
						<p class="description">Kosongkan lalu simpan untuk membuat ulang otomatis.</p></td>
				</tr>
			</table>
			<p>URL webhook untuk didaftarkan di Mayar (POST /hl/v2/webhooks/update):<br />
				<code><?php echo esc_html( rest_url( ICD10CARE_NS . '/mayar/hook/' . $o['webhook_secret'] ) ); ?></code></p>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	$links[] = '<a href="' . esc_url( admin_url( 'options-general.php?page=icd10-care' ) ) . '">Pengaturan</a>';
	return $links;
} );

/* =========================================================================
 * TIKET CS (Custom Post Type)
 * ========================================================================= */

add_action( 'init', function () {
	register_post_type( 'icd10_ticket', array(
		'label'         => 'Tiket CS ICD-10',
		'labels'        => array( 'name' => 'Tiket CS ICD-10', 'singular_name' => 'Tiket CS' ),
		'public'        => false,
		'show_ui'       => true,
		'show_in_menu'  => true,
		'menu_icon'     => 'dashicons-email-alt',
		'supports'      => array( 'title', 'editor' ),
		'capability_type' => 'post',
		'map_meta_cap'  => true,
	) );
} );

/* =========================================================================
 * REST API  (namespace icd10/v1)
 * ========================================================================= */

add_action( 'rest_api_init', function () {
	$open = '__return_true';
	register_rest_route( ICD10CARE_NS, '/care', array(
		'methods'             => 'POST',
		'callback'            => 'icd10care_rest_care',
		'permission_callback' => $open,
	) );
	register_rest_route( ICD10CARE_NS, '/ticket', array(
		'methods'             => 'POST',
		'callback'            => 'icd10care_rest_ticket',
		'permission_callback' => $open,
	) );
	register_rest_route( ICD10CARE_NS, '/license/verify', array(
		'methods'             => 'POST',
		'callback'            => 'icd10care_rest_license',
		'permission_callback' => $open,
	) );
} );

// Aplikasi desktop memanggil lintas-origin, izinkan CORS untuk namespace ini.
add_filter( 'rest_pre_serve_request', function ( $served, $result, $request ) {
	if ( strpos( $request->get_route(), '/' . ICD10CARE_NS . '/' ) === 0 ) {
		header( 'Access-Control-Allow-Origin: *' );
		header( 'Access-Control-Allow-Methods: POST, OPTIONS' );
		header( 'Access-Control-Allow-Headers: Content-Type' );
	}
	return $served;
}, 10, 3 );

function icd10care_rate_limit( $bucket, $max, $window ) {
	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? $_SERVER['REMOTE_ADDR'] : '0';
	$key = 'icd10care_rl_' . $bucket . '_' . md5( $ip );
	$n   = (int) get_transient( $key );
	if ( $n >= $max ) { return false; }
	set_transient( $key, $n + 1, $window );
	return true;
}

/* ---------- Chatbot ---------- */

function icd10care_norm( $s ) {
	$s = function_exists( 'mb_strtolower' ) ? mb_strtolower( $s, 'UTF-8' ) : strtolower( $s );
	return preg_replace( '/[^a-z0-9\s\-]/u', ' ', $s );
}

function icd10care_match( $msg ) {
	$n    = icd10care_norm( $msg );
	$best = null;
	$top  = 0;
	foreach ( icd10care_faq() as $f ) {
		$score = 0;
		foreach ( $f['k'] as $kw ) {
			$kn = icd10care_norm( $kw );
			if ( $kn !== '' && strpos( $n, $kn ) !== false ) {
				$score += 1 + substr_count( $kn, ' ' );
			}
		}
		$score += ( $score > 0 && isset( $f['p'] ) ) ? (int) $f['p'] : 0; // prioritas hanya bila ada kata kunci cocok
		if ( $score > $top ) { $top = $score; $best = $f; }
	}
	return $top > 0 ? $best : null;
}

function icd10care_rest_care( WP_REST_Request $req ) {
	if ( ! icd10care_rate_limit( 'care', 40, MINUTE_IN_SECONDS ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'rate_limited' ), 429 );
	}
	$msg = trim( (string) $req->get_param( 'message' ) );
	if ( $msg === '' || strlen( $msg ) > 2000 ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'bad_message' ), 400 );
	}
	$hit = icd10care_match( $msg );
	if ( $hit ) {
		return new WP_REST_Response( array(
			'ok'       => true,
			'answered' => true,
			'topic'    => $hit['t'],
			'reply'    => $hit['a'],
		), 200 );
	}
	return new WP_REST_Response( array(
		'ok'       => true,
		'answered' => false,
		'escalate' => true,
		'reply'    => 'Maaf, saya belum punya jawaban pasti untuk itu. Kirim pertanyaanmu ke tim CS kami, akan dibalas ke emailmu.',
	), 200 );
}

/* ---------- Tiket ---------- */

function icd10care_rest_ticket( WP_REST_Request $req ) {
	if ( ! icd10care_rate_limit( 'ticket', 5, 10 * MINUTE_IN_SECONDS ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'rate_limited' ), 429 );
	}
	if ( $req->get_param( 'website' ) ) { // honeypot
		return new WP_REST_Response( array( 'ok' => true, 'ticketId' => 0 ), 200 );
	}
	$name       = sanitize_text_field( (string) $req->get_param( 'name' ) );
	$email      = sanitize_email( (string) $req->get_param( 'email' ) );
	$message    = sanitize_textarea_field( (string) $req->get_param( 'message' ) );
	$transcript = sanitize_textarea_field( (string) $req->get_param( 'transcript' ) );
	if ( $message === '' || ! is_email( $email ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'bad_input' ), 400 );
	}
	$support = icd10care_opt( 'support_email' );
	if ( ! is_email( $support ) ) { $support = ICD10CARE_DEFAULT_EMAIL; }

	$title = '[ICD-10] ' . wp_trim_words( $message, 10, '…' );
	$post_id = wp_insert_post( array(
		'post_type'    => 'icd10_ticket',
		'post_status'  => 'private',
		'post_title'   => $title,
		'post_content' => $message,
	), true );
	if ( is_wp_error( $post_id ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'store_failed' ), 500 );
	}
	update_post_meta( $post_id, '_icd10_name', $name );
	update_post_meta( $post_id, '_icd10_email', $email );
	update_post_meta( $post_id, '_icd10_transcript', $transcript );

	$body  = "Tiket CS ICD-10 Codex 2010\n\n";
	$body .= 'Nama  : ' . $name . "\n";
	$body .= 'Email : ' . $email . "\n\n";
	$body .= "Pesan:\n" . $message . "\n\n";
	if ( $transcript !== '' ) { $body .= "--- Transkrip chat ---\n" . $transcript . "\n"; }

	$headers = array( 'Reply-To: ' . ( $name !== '' ? $name : 'Pelanggan' ) . ' <' . $email . '>' );
	$sent = wp_mail( $support, 'Tiket CS ICD-10 Codex 2010', $body, $headers );

	return new WP_REST_Response( array(
		'ok'       => true,
		'ticketId' => (int) $post_id,
		'emailed'  => (bool) $sent,
	), 200 );
}

/* ---------- Verifikasi Lisensi (proxy ke Mayar) ---------- */

function icd10care_rest_license( WP_REST_Request $req ) {
	if ( ! icd10care_rate_limit( 'lic', 30, MINUTE_IN_SECONDS ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'rate_limited' ), 429 );
	}
	$code = strtoupper( trim( (string) $req->get_param( 'code' ) ) );
	if ( $code === '' || ! preg_match( '/^[A-Z0-9\-]{4,64}$/', $code ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'bad_code' ), 400 );
	}
	// Lisensi yang diterbitkan checkout sendiri (tanpa lewat Mayar).
	$local = icd10care_local_license_check( $code );
	if ( $local !== null ) {
		return new WP_REST_Response( $local, 200 );
	}
	$key = icd10care_opt( 'mayar_api_key' );
	$pid = icd10care_opt( 'mayar_product_id' );
	if ( $key === '' || $pid === '' ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_configured' ), 503 );
	}

	$resp = wp_remote_post( 'https://api.mayar.id/software/v1/license/verify', array(
		'timeout' => 15,
		'headers' => array(
			'Authorization' => 'Bearer ' . $key,
			'Content-Type'  => 'application/json',
			'Accept'        => 'application/json',
		),
		'body'    => wp_json_encode( array( 'licenseCode' => $code, 'productId' => $pid ) ),
	) );

	if ( is_wp_error( $resp ) ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'upstream_unreachable' ), 502 );
	}
	$http = (int) wp_remote_retrieve_response_code( $resp );
	$data = json_decode( wp_remote_retrieve_body( $resp ), true );
	$sc   = is_array( $data ) && isset( $data['statusCode'] ) ? (int) $data['statusCode'] : $http;

	if ( $http === 401 || $sc === 401 ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'upstream_auth' ), 502 );
	}
	if ( $http === 404 || $sc === 404 ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_found' ), 404 );
	}
	if ( $http < 200 || $http >= 300 ) {
		return new WP_REST_Response( array( 'ok' => false, 'error' => 'upstream_error', 'upstream' => $sc ), 502 );
	}

	$lc = isset( $data['licenseCode'] ) ? $data['licenseCode'] : array();
	if ( isset( $lc[0] ) && is_array( $lc[0] ) ) { $lc = $lc[0]; } // bentuk array (v1)

	return new WP_REST_Response( array(
		'ok'        => true,
		'active'    => ! empty( $data['isLicenseActive'] ),
		'status'    => isset( $lc['status'] ) ? $lc['status'] : null,
		'owner'     => isset( $lc['customerName'] ) ? $lc['customerName'] : null,
		'email'     => isset( $lc['customerEmail'] ) ? $lc['customerEmail'] : null,
		'expiresAt' => isset( $lc['expiredAt'] ) ? $lc['expiredAt'] : null,
		'productId' => isset( $lc['productId'] ) ? $lc['productId'] : $pid,
	), 200 );
}

/* =========================================================================
 * ISI FAQ (bilingual keyword, jawaban Indonesia)
 * ========================================================================= */

function icd10care_faq() {
	$app   = 'https://ruangpmik.myr.id/app/icd-10-codex-2010';
	$saran = 'https://ruangpmik.myr.id/support';
	return array(
		array( 't' => 'install', 'k' => array( 'cara install', 'instal', 'install', 'pasang', 'setup', 'unduh', 'download', 'installer', 'cara pakai', 'cara buka' ),
			'a' => 'Unduh installer dari email pembelian atau laman produk ' . $app . ', lalu jalankan file-nya. Buka aplikasi lewat Start Menu atau ikon di Desktop. Tidak perlu koneksi internet untuk memakai.' ),
		array( 't' => 'activate', 'k' => array( 'aktivasi', 'activate', 'kode lisensi', 'license', 'lisensi', 'serial', 'kunci', 'masukkan kode', 'cara aktif' ),
			'a' => 'Buka aplikasi, saat diminta masukkan kode lisensi yang kamu terima lewat email setelah pembayaran. Klik Aktifkan. Setelah valid, aplikasi siap dipakai offline.' ),
		array( 't' => 'no_code', 'p' => 3, 'k' => array( 'belum dapat kode', 'belum terima kode', 'kode tidak diterima', 'kode tidak masuk', 'tidak ada kode', 'belum terima email', 'belum dapat email', 'belum masuk', 'tidak sampai', 'email tidak', 'belum dikirim', 'belum kirim' ),
			'a' => 'Kode lisensi dikirim otomatis ke email pembelian setelah pembayaran berhasil. Cek folder Spam/Promosi. Jika lebih dari 1 jam belum ada, kirim tiket lewat tombol "Hubungi CS" di bawah dengan email pembelianmu.' ),
		array( 't' => 'price', 'k' => array( 'harga', 'price', 'biaya', 'berapa', 'bayar berapa', 'tarif' ),
			'a' => 'Harga sekali bayar (aktif selamanya) tertera di laman pembelian. Tidak ada langganan bulanan/tahunan.' ),
		array( 't' => 'payment', 'k' => array( 'metode pembayaran', 'cara bayar', 'pembayaran', 'bank', 'qris', 'transfer', 'va', 'e-wallet', 'gopay', 'ovo', 'dana' ),
			'a' => 'Pembayaran lewat laman Mayar kami: tersedia transfer bank/VA, QRIS, dan e-wallet. Kode lisensi terbit otomatis setelah pembayaran terkonfirmasi.' ),
		array( 't' => 'offline', 'k' => array( 'offline', 'tanpa internet', 'butuh internet', 'koneksi' ),
			'a' => 'Aplikasi berjalan penuh secara offline. Internet hanya dipakai sekali saat aktivasi kode lisensi.' ),
		array( 't' => 'multi', 'k' => array( 'beberapa komputer', 'banyak komputer', 'multi', 'limit', 'device', 'perangkat', 'pindah komputer', 'ganti laptop' ),
			'a' => 'Kode lisensi berlaku untuk 1 perangkat. Kalau ganti komputer, kirim tiket dengan email pembelian dan jelaskan kondisinya (mis. laptop lama rusak/dijual).' ),
		array( 't' => 'update', 'k' => array( 'update', 'upgrade', 'versi baru', 'pembaruan', 'fitur baru', 'bagaimana update' ),
			'a' => 'Pembaruan fitur dirilis berkala. Untuk membuka pembaruan, cukup Traktir Kopi di ' . $saran . ' — setelah itu kirim bukti dan email pembelian via CS, kami kirimkan versi terbaru.' ),
		array( 't' => 'refund', 'k' => array( 'refund', 'pengembalian dana', 'batal', 'cancel', 'uang kembali', 'garansi' ),
			'a' => 'Karena produk digital terkirim langsung, permintaan pengembalian dana ditangani per kasus. Kirim tiket dengan email pembelian dan alasanmu, tim CS akan menindaklanjuti.' ),
		array( 't' => 'os', 'k' => array( 'mac', 'macos', 'apple', 'linux', 'ubuntu', 'android', 'ios', 'hp', 'ponsel' ),
			'a' => 'Saat ini ICD-10 Codex 2010 tersedia untuk Windows 10/11 (64-bit). Dukungan macOS sedang direncanakan.' ),
		array( 't' => 'smartscreen', 'k' => array( 'smart screen', 'smartscreen', 'unknown publisher', 'publisher', 'windows defender', 'diblokir', 'tidak dikenal' ),
			'a' => 'Windows bisa menampilkan "Unknown publisher" karena installer belum ditandatangani secara digital. Itu wajar dan aman selama file diunduh dari sumber resmi. Klik "More info" lalu "Run anyway".' ),
		array( 't' => 'source', 'k' => array( 'sumber data', 'who', 'kemenkes', 'legal', 'lisensi who', 'hak cipta', 'copyright', 'asli' ),
			'a' => 'Sumber data mengikuti WHO ICD-10 Edisi 2010 (format ClaML), ditambah padanan istilah Indonesia. Penggunaan data mengikuti ketentuan WHO.' ),
		array( 't' => 'idata', 'k' => array( 'bahasa indonesia', 'istilah indonesia', 'terjemahan', '437', 'kamus' ),
			'a' => 'Ya. Tersedia 22 bab, 437 padanan istilah Indonesia, kamus istilah, indeks A–Z, indeks morfologi neoplasma, dan tabel khusus.' ),
		array( 't' => 'error', 'k' => array( 'error', 'tidak bisa dibuka', 'tidak mau jalan', 'crash', 'macet', 'hang', 'gagal buka', 'blank', 'putih' ),
			'a' => 'Coba tutup lalu buka lagi aplikasi, dan pastikan Windows 10/11 64-bit. Jika masih bermasalah, kirim tiket dengan versi Windows dan tangkapan layar error.' ),
		array( 't' => 'donate', 'k' => array( 'donasi', 'traktir', 'kopi', 'support', 'dukung', 'sedekah', 'sumbang' ),
			'a' => 'Terima kasih! Traktir Kopi bisa di ' . $saran . '. Sedekah seikhlasnya, gunakan sepuasnya.' ),
		array( 't' => 'contact', 'k' => array( 'kontak', 'hubungi', 'cs', 'customer service', 'email', 'admin', 'tanya' ),
			'a' => 'Kamu bisa kirim pertanyaan lewat tombol "Hubungi CS" di bawah. Tim CS akan membalas ke email yang kamu isi.' ),
		array( 't' => 'why', 'k' => array( 'apa ini', 'tentang aplikasi', 'kegunaan', 'untuk apa', 'manfaat' ),
			'a' => 'ICD-10 Codex 2010 adalah penampil rujukan ICD-10 Edisi 2010 WHO, lengkap padanan istilah Indonesia. Ditujukan untuk perekam medis, koder, dan mahasiswa kesehatan. Berjalan offline.' ),
	);
}

/* =========================================================================
 * SHORTCODE  [icd10_care]
 * ========================================================================= */

add_shortcode( 'icd10_care', function ( $atts ) {
	$ep_care   = esc_url_raw( rest_url( ICD10CARE_NS . '/care' ) );
	$ep_ticket = esc_url_raw( rest_url( ICD10CARE_NS . '/ticket' ) );
	$support   = icd10care_opt( 'support_link' );
	$uid       = 'icd10care-' . wp_rand( 1000, 9999 );

	ob_start();
	?>
	<div class="icd10care" id="<?php echo esc_attr( $uid ); ?>"
		data-care="<?php echo esc_attr( $ep_care ); ?>"
		data-ticket="<?php echo esc_attr( $ep_ticket ); ?>">
		<div class="icd10care-head">
			<div class="icd10care-avatar">R</div>
			<div>
				<div class="icd10care-title">Customer Care — ICD-10 Codex 2010</div>
				<div class="icd10care-sub"><span class="icd10care-dot"></span> Dijawab otomatis · tiket via email</div>
			</div>
		</div>
		<div class="icd10care-log" aria-live="polite"></div>
		<div class="icd10care-chips">
			<button type="button" data-q="Bagaimana cara mengaktifkan kode lisensi?">Aktivasi lisensi</button>
			<button type="button" data-q="Apakah bisa dipakai offline?">Bisa offline?</button>
			<button type="button" data-q="Bagaimana cara update / upgrade fitur?">Update fitur</button>
			<button type="button" data-q="Metode pembayaran apa saja?">Cara bayar</button>
		</div>
		<form class="icd10care-form" autocomplete="off">
			<input type="text" class="icd10care-input" placeholder="Tulis pertanyaanmu…" maxlength="1000" />
			<button type="submit" class="icd10care-send" aria-label="Kirim">Kirim</button>
		</form>
		<div class="icd10care-actions">
			<button type="button" class="icd10care-link icd10care-open-ticket">Hubungi CS (buat tiket)</button>
			<a class="icd10care-link" href="<?php echo esc_url( $support ); ?>" target="_blank" rel="noopener">Traktir Kopi ☕</a>
		</div>
		<form class="icd10care-ticket" hidden>
			<p class="icd10care-ticket-note">Isi datamu, pertanyaan akan diteruskan ke tim CS dan dibalas lewat email.</p>
			<input type="text" name="name" placeholder="Nama" maxlength="80" />
			<input type="email" name="email" placeholder="Email (wajib)" maxlength="120" required />
			<textarea name="message" rows="3" placeholder="Tulis pesanmu…" maxlength="2000" required></textarea>
			<input type="text" name="website" class="icd10care-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
			<div class="icd10care-ticket-btns">
				<button type="submit" class="icd10care-send">Kirim tiket</button>
				<button type="button" class="icd10care-cancel">Tutup</button>
			</div>
			<div class="icd10care-ticket-status" role="status"></div>
		</form>
	</div>
	<?php
	return ob_get_clean();
} );

// Aset tampilan + logika chat. Dimuat sekali.
add_action( 'wp_footer', function () {
	static $done = false;
	if ( $done || ! is_singular() ) { return; }
	global $post;
	if ( ! $post || ! has_shortcode( (string) $post->post_content, 'icd10_care' ) ) { return; }
	$done = true;
	?>
	<style>
	.icd10care{--navy:#0f2a43;--teal:#0d9488;max-width:640px;margin:24px auto;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 10px 30px rgba(15,42,67,.08)}
	.icd10care-head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:linear-gradient(135deg,#0f2a43,#0d9488);color:#fff}
	.icd10care-avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700}
	.icd10care-title{font-weight:600;font-size:14.5px}
	.icd10care-sub{font-size:12px;opacity:.85;display:flex;align-items:center;gap:6px}
	.icd10care-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block}
	.icd10care-log{padding:16px;min-height:180px;max-height:380px;overflow-y:auto;background:#f8fafc;display:flex;flex-direction:column;gap:10px}
	.icd10care-msg{max-width:82%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap}
	.icd10care-msg.bot{background:#fff;border:1px solid #e2e8f0;align-self:flex-start;border-bottom-left-radius:4px}
	.icd10care-msg.user{background:var(--teal);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
	.icd10care-chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 12px}
	.icd10care-chips button{font-size:12px;padding:6px 11px;border:1px solid #cbd5e1;background:#fff;border-radius:999px;cursor:pointer;color:#0f2a43}
	.icd10care-chips button:hover{border-color:var(--teal);color:var(--teal)}
	.icd10care-form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0}
	.icd10care-input{flex:1;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px}
	.icd10care-send{padding:10px 16px;border:0;border-radius:10px;background:var(--teal);color:#fff;font-weight:600;cursor:pointer;font-size:13px}
	.icd10care-actions{display:flex;gap:14px;padding:0 16px 14px}
	.icd10care-link{background:none;border:0;padding:0;color:var(--teal);font-size:12.5px;cursor:pointer;text-decoration:underline}
	.icd10care-ticket{padding:14px 16px;border-top:1px solid #e2e8f0;display:flex;flex-direction:column;gap:8px}
	.icd10care-ticket-note{margin:0;font-size:12.5px;color:#475569}
	.icd10care-ticket input,.icd10care-ticket textarea{padding:9px 11px;border:1px solid #cbd5e1;border-radius:9px;font-size:13.5px;width:100%;box-sizing:border-box}
	.icd10care-hp{position:absolute!important;left:-9999px!important}
	.icd10care-ticket-btns{display:flex;gap:8px}
	.icd10care-cancel{padding:10px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:10px;cursor:pointer;font-size:13px}
	.icd10care-ticket-status{font-size:12.5px;color:#475569}
	</style>
	<script>
	(function(){
	document.querySelectorAll('.icd10care').forEach(function(root){
	var care=root.getAttribute('data-care'),ticket=root.getAttribute('data-ticket');
	var log=root.querySelector('.icd10care-log'),form=root.querySelector('.icd10care-form');
	var input=root.querySelector('.icd10care-input'),chipBox=root.querySelector('.icd10care-chips');
	var tform=root.querySelector('.icd10care-ticket'),tstatus=root.querySelector('.icd10care-ticket-status');
	var lastUser='',history=[];
	function add(who,text){var d=document.createElement('div');d.className='icd10care-msg '+who;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;history.push((who==='user'?'Pelanggan: ':'CS: ')+text);return d;}
	add('bot','Halo! Saya asisten Customer Care ICD-10 Codex 2010.\nAda yang bisa saya bantu?');
	function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{};});});}
	function ask(text){if(!text)return;add('user',text);lastUser=text;var wait=add('bot','…');
	post(care,{message:text}).then(function(r){wait.remove();
	if(r&&r.answered){add('bot',r.reply);}
	else{add('bot',(r&&r.reply)||'Maaf, saya belum bisa menjawab itu.');openTicket();}
	}).catch(function(){wait.remove();add('bot','Koneksi bermasalah. Coba lagi atau buat tiket ke CS.');});}
	form.addEventListener('submit',function(e){e.preventDefault();var v=input.value.trim();input.value='';ask(v);});
	chipBox.addEventListener('click',function(e){var b=e.target.closest('button');if(b)ask(b.getAttribute('data-q'));});
	function openTicket(){tform.hidden=false;var m=tform.querySelector('[name=message]');if(m&&!m.value)m.value=lastUser;tform.scrollIntoView({behavior:'smooth',block:'nearest'});}
	root.querySelector('.icd10care-open-ticket').addEventListener('click',openTicket);
	root.querySelector('.icd10care-cancel').addEventListener('click',function(){tform.hidden=true;});
	tform.addEventListener('submit',function(e){e.preventDefault();tstatus.textContent='Mengirim…';
	var fd={name:tform.name.value,email:tform.email.value,message:tform.message.value,website:tform.website.value,transcript:history.join('\n')};
	post(ticket,fd).then(function(r){if(r&&r.ok){if(tform.website.value){return;}tstatus.textContent='Tiket terkirim. Terima kasih! Kami akan membalas ke emailmu.';tform.querySelector('[type=submit]').disabled=true;}
	else{tstatus.textContent='Gagal mengirim ('+(r&&r.error||'error')+'). Pastikan email valid, coba lagi.';}})
	.catch(function(){tstatus.textContent='Gagal mengirim. Coba lagi.';});});
	});
	})();
	</script>
	<?php
}, 20 );

/* =========================================================================
 * AKTIVASI
 * ========================================================================= */

register_activation_hook( __FILE__, function () {
	$s = get_option( 'icd10care_settings' );
	if ( ! $s ) {
		add_option( 'icd10care_settings', icd10care_defaults() );
	} elseif ( empty( $s['webhook_secret'] ) ) {
		$s['webhook_secret'] = wp_generate_password( 40, false, false );
		update_option( 'icd10care_settings', $s );
	}
	icd10care_install();
	if ( ! wp_next_scheduled( 'icd10care_reconcile_cron' ) ) {
		wp_schedule_event( time() + 120, 'icd10care_five_min', 'icd10care_reconcile_cron' );
	}
} );
