<script lang="ts">
  import type { Snippet } from 'svelte';
  import OAuthIcons from './OAuthIcons.svelte';

  type Provider = 'steam' | 'discord' | 'psn';

  let {
    provider = 'steam' as Provider,
    loading = false,
    disabled = false,
    onclick,
  }: {
    provider?: Provider;
    loading?: boolean;
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
  } = $props();

  function getLabel(p: Provider): string {
    switch (p) {
      case 'steam': return 'Continuer avec Steam';
      case 'discord': return 'Continuer avec Discord';
      case 'psn': return 'Lier PlayStation';
    }
  }
</script>

<button type="button"
  class="oauth-button oauth-button--{provider}"
  onclick={onclick}
  class:oauth-button--loading={loading || disabled}
  disabled={loading || disabled}
>
  <span class="oauth-button__label">{getLabel(provider)}</span>
  <span class="oauth-button__icon">
    <OAuthIcons {provider} />
  </span>
</button>

<style>
  .oauth-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
    white-space: nowrap;
  }

  .oauth-button--steam {
    background: linear-gradient(135deg, #1a1a1a 0%, #2f2f2f 100%);
    color: white;
  }

  .oauth-button--steam:hover:not(.oauth-button--loading) {
    background: linear-gradient(135deg, #2a2a2a 0%, #3f3f3f 100%);
    transform: translateY(-2px);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.4);
  }

  .oauth-button--discord {
    background: #7289da;
    color: white;
  }

  .oauth-button--discord:hover:not(.oauth-button--loading) {
    background: #5b7bd5;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.4);
  }

  .oauth-button--psn {
    background: #003265;
    color: white;
  }

  .oauth-button--psn:hover:not(.oauth-button--loading) {
    background: #00254a;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.4);
  }

  .oauth-button--loading {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .oauth-button__label {
    display: inline-block;
  }

  .oauth-button__icon {
    display: inline-flex;
    align-items: center;
  }


  .oauth-button:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .oauth-button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
