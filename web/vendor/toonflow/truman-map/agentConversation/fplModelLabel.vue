<script setup lang="ts">
defineProps<{ label: string; providerId?: string; modelId?: string }>();
</script>

<template><span>{{ label }}</span></template>
