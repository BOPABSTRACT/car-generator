/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // make sure the Word template ships with the export function on Vercel
    outputFileTracingIncludes: {
      '/api/export-car': ['./templates/**/*'],
    },
    serverComponentsExternalPackages: ['word-extractor', 'exceljs'],
  },
};
module.exports = nextConfig;
