<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import Seo from '#lib/components/Seo.svelte';
</script>

<Seo title="{m.privacy()} — Project Achievers" description={m.privacy_intro()} />

<article class="prose-user mx-auto max-w-2xl">
  <h1>{m.privacy()}</h1>
  <p>
    {m.privacy_intro()}
    <a href="mailto:contact@achievers.games">contact@achievers.games</a>
  </p>

  <h2 class="pt-4">{m.privacy_data()}</h2>
  <ul>
    <li>{m.privacy_data_accounts()}</li>
    <li>{m.privacy_data_partners()}</li>
    <li>{m.privacy_data_partner_sharing()}</li>
    <li>{m.privacy_data_library()}</li>
    <li>{m.privacy_data_content()}</li>
    <li>{m.privacy_data_sessions()}</li>
    <li>{m.privacy_data_social()}</li>
    <li>{m.privacy_data_push()}</li>
    <li>{m.privacy_data_feedback()}</li>
  </ul>

  <h2 class="pt-4">{m.privacy_not_collected()}</h2>
  <p>{m.privacy_not_collected_text()}</p>

  <h2 class="pt-4">{m.privacy_translation()}</h2>
  <p>{m.privacy_translation_text()}</p>

  <h2 class="pt-4">{m.privacy_rights()}</h2>
  <p>{m.privacy_rights_text()}</p>
  <p><a href="/compte">{m.privacy_account_link()}</a></p>
</article>
