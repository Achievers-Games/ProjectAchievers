<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  type Provider = 'steam' | 'discord' | 'psn';
  export let provider: Provider = 'steam';
  export let loading: boolean = false;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher();

  function handleClick() {
    if (loading || disabled) return;
    dispatch('click');
  }

  function getLabel(p: Provider): string {
    switch (p) {
      case 'steam': return 'Continuer avec Steam';
      case 'discord': return 'Continuer avec Discord';
      case 'psn': return 'Lier PlayStation';
    }
  }

  function getSvgIcon(p: Provider): string {
    switch (p) {
      case 'steam': return `<path d="M15.5,4C14.67,4 14,4.67 14,5.5V7.83C13.47,7.53 12.77,7.42 12.14,7.5C11.5,7.58 11,7.95 10.66,8.46C9.67,7.63 9.12,6.17 10.07,5.23C11.02,4.29 12.42,4 14,4C15.33,4 16.5,4.53 17.3,5.54C16.85,6.13 15.97,6.45 15.1,6.51C15.48,7.06 15.5,7.55 15.5,8.5V11C15.5,12.33 14.83,13 13.5,13H10.5C9.17,13 8.5,12.33 8.5,11V8.5C8.5,7.55 8.52,7.06 8.9,6.51C8.03,6.45 7.15,6.13 6.7,5.54C7.5,4.53 8.67,4 10,4C11.33,4 12.33,4.53 13,5.54C12.55,6.13 11.67,6.45 10.8,6.5C10.42,6.05 10.4,5.5 10.4,5.5V5.5C10.4,4.67 11.07,4 12,4C13.33,4 14.33,4.53 15,5.54C14.55,6.13 13.67,6.45 12.9,6.5C13.28,7.05 13.5,7.55 13.5,8.5V11C13.5,12.33 12.83,13 11.5,13H10.5C9.17,13 8.5,12.33 8.5,11V8.5C8.5,7.67 9.17,7 10,7C10.55,7 11,7.37 11.3,7.9C11,7.39 11,6.85 11,6.5V5.5C11,4.67 11.67,4 12.5,4C13.67,4 15,5.33 15.5,7.33V11C15.5,12.33 14.83,13 14,13H10C9.17,13 9,12.33 9,11V8.5C9,7.67 9.67,7 10.5,7C10.83,7 11.33,7.33 11.66,7.83C11.33,8.34 10.83,8.83 10.5,9.5V11C10.5,12.33 9.83,13 9,13H6C4.67,13 4,12.33 4,11V8.5C4,7.55 4.5,6.83 5.3,6.33C4.5,6.67 4,7.33 4,8.5V11C4,12.33 5.33,13 7,13H9C10.67,13 12,11.67 12,10V8.5C12,7.55 11.5,6.83 10.7,6.33C11.5,6.67 12,7.33 12,8.5V11C12,12.33 10.67,13 9,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54C8.55,6.13 8.17,6.45 7.9,6.5C8.28,7.05 8.5,7.55 8.5,9.5V11C8.5,12.33 7.83,13 7,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54C8.55,6.13 8.17,6.45 7.9,6.5C8.28,7.05 8.5,7.55 8.5,9.5V11C8.5,12.33 7.83,13 7,13H6C4.67,13 4,12.33 4,11V8.5C4,7.67 4.67,7 5.5,7C5.83,7 5.33,6.5 5,6V5.5C5,4.67 5.67,4 6.5,4C7.67,4 8.33,4.53 9,5.54Z"/>`;
      case 'discord': return `<path d="M20.317,4.37a19.791,19.791,0,0,0-4.885-1.515.074.074,0,0,0-.079.037c-.21.38-.44.735-.692,1.1a17.179,17.179,0,0,0-5.173,0c-.24-.36-.476-.72-.686-1.1a.077.077,0,0,0-.079-.037A19.736,19.736,0,0,0,3.683,4.37A.07.07,0,0,0,3.62,4.44C2.86,5.45,2.38,6.81,2.24,8.23a.077.077,0,0,0,.031.071C2.54,9.48,2.83,10.56,3.2,11.56a19.9,19.9,0,0,0,.6,2.43.077.077,0,0,0,.079.037h.056a20.116,20.116,0,0,0,5.416,2.185.077.077,0,0,0,.079-.037c.242-.377.47-.767.686-1.168a17.156,17.156,0,0,0,5.187,0,17.156,17.156,0,0,0,5.186,0c.218.401.474.786.69,1.168a.077.077,0,0,0,.079.037h.056a20.112,20.112,0,0,0,5.416-2.185.077.077,0,0,0,.079-.037,19.653,19.653,0,0,0,5.2-2.58.077.077,0,0,0-.031-.071C21.37,6.8,20.85,5.45,20.317,4.37ZM12,21.35c-3.17,0-6.13-1.23-8.32-3.37a14.37,14.37,0,0,1-1.28-3.39c0-.18.02-.36.02-.54,0-1.76,1-2.7,2.52-3.55,1.17-.65,2.72-1.5,4.41-2.1,1.42-.51,2.86-1.1,4.3-1.73a.077.077,0,0,1,.107,0c1.42.63,2.85,1.22,4.27,1.73,1.69.6,3.24,1.45,4.4,2.1,1.52.85,2.52,1.79,2.52,3.55,0,.18.02.36.02.54a13.31,13.31,0,0,1-1.28,3.39C18.13,18.12,15.17,19.35,12,21.35Z"/>`;
      case 'psn': return `<path d="M11.67,2.5a.5.5,0,0,1,.67,0l4.67,6a.5.5,0,0,1-.17.68H10.83A.5.5,0,0,1,10.5,9V3.18A.5.5,0,0,1,11,2.67ZM15.57,10.15a.5.5,0,0,1-.17-.68l-2.33-3a.5.5,0,0,1,.67-.67l2.33,3A.5.5,0,0,1,15.57,10.15ZM21.17,15.5a.5.5,0,0,1-.5.5H6.83a.5.5,0,0,1-.5-.5V10.5a.5.5,0,0,1,.5-.5H8.17a.5.5,0,0,0,0-1H2.83A1.83,1.83,0,0,0,1,11.83V20.17A1.83,1.83,0,0,0,2.83,22H21.17A1.83,1.83,0,0,0,23,20.17V16A.5.5,0,0,1,21.17,15.5ZM11.83,17.5a.5.5,0,0,1-.5-.5v-4a.5.5,0,0,1,1,0v4A.5.5,0,0,1,11.83,17.5ZM16.83,17.5a.5.5,0,0,1-.5-.5v-4a.5.5,0,0,1,1,0v4A.5.5,0,0,1,16.83,17.5Z"/>`;
    }
  }
</script>

<button type="button"
  class="oauth-button oauth-button--{provider}"
  on:click={handleClick}
  class:oauth-button--loading={loading || disabled}
  disabled={loading || disabled}
>
  <span class="oauth-button__label">{getLabel(provider)}</span>
  <span class="oauth-button__icon">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted static icon markup -->
      {@html getSvgIcon(provider)}
    </svg>
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

  .oauth-button__icon svg {
    flex-shrink: 0;
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