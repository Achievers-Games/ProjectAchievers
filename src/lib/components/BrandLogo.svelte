<script lang="ts">
  let { footer = false }: { footer?: boolean } = $props();
</script>

<span class="brand-logo" class:footer role="img" aria-label="Achievers">
  <span class="brand-wordmark" aria-hidden="true"></span>
  <img class="brand-symbol" src="/brand/achievers-mark.svg" width="30" height="30" alt="" />
</span>

<style>
  .brand-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 144px;
    height: 36px;
    flex-shrink: 0;
    vertical-align: middle;
  }
  .brand-wordmark {
    display: block;
    width: 100%;
    height: 100%;
    background-color: currentColor;
    mask: url('/brand/achievers-wordmark.svg') center / contain no-repeat;
  }
  .brand-symbol {
    display: none;
  }
  @media (max-width: 1023px) {
    .brand-logo {
      width: 112px;
      height: 28px;
    }
  }
  @media (max-width: 639px) {
    .brand-logo {
      width: 104px;
      height: 26px;
    }
  }
  @media (max-width: 379px) {
    .brand-logo {
      width: 88px;
      height: 24px;
    }
  }
  @media (max-width: 359px) {
    .brand-logo:not(.footer) {
      width: 30px;
      height: 32px;
    }
    .brand-logo:not(.footer) .brand-wordmark {
      display: none;
    }
    .brand-logo:not(.footer) .brand-symbol {
      display: block;
    }
  }
  .brand-logo.footer {
    width: 108px;
    height: 27px;
  }
</style>
