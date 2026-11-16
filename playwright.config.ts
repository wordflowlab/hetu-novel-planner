import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/ui',workers:1,timeout:180000,reporter:'list',outputDir:'test-results',use:{trace:'retain-on-failure'}});
