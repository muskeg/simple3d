import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/browser',
	fullyParallel: false,
	workers: 1,
	timeout: 45000,
	expect: { timeout: 15000 },
	use: {
		baseURL: 'http://127.0.0.1:5180/simple3d/',
		viewport: { width: 1440, height: 900 },
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
	},
	webServer: {
		command: `npm run ${process.env.PLAYWRIGHT_PREVIEW ? 'preview' : 'dev'} -- --host 127.0.0.1 --port 5180 --strictPort`,
		url: 'http://127.0.0.1:5180/simple3d/',
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
	},
});