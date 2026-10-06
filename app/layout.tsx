import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'CAR & Pad Summary Generator',
  description: 'BOP Abstract internal tool for Curative Action Reports and Pad Summaries',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; }
          body {
            background: linear-gradient(135deg, #D97706 0%, #1F2937 100%);
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
          }
          .container {
            max-width: 1100px;
            margin: 0 auto;
            background: #F3F4F6;
            padding: 30px;
            border-radius: 8px;
          }
          h1 {
            color: #D97706;
            text-align: center;
            margin-bottom: 30px;
          }
          h2 {
            color: #1F2937;
            margin-top: 30px;
            margin-bottom: 15px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #1F2937;
          }
          input[type="text"], textarea, input[type="file"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #D97706;
            border-radius: 4px;
            font-size: 14px;
            font-family: Arial, sans-serif;
          }
          textarea {
            resize: vertical;
            min-height: 80px;
          }
          .button-group {
            display: flex;
            gap: 10px;
            margin-top: 30px;
          }
          button {
            flex: 1;
            padding: 12px;
            font-size: 16px;
            font-weight: bold;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: Arial, sans-serif;
          }
          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .btn-demo { background: #D97706; color: white; }
          .btn-demo:hover:not(:disabled) { background: #B45309; }
          .btn-real { background: #1F2937; color: white; }
          .btn-real:hover:not(:disabled) { background: #111827; }
          .btn-export { background: #059669; color: white; }
          .btn-export:hover:not(:disabled) { background: #047857; }
          .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 4px;
          }
          .status.success { background: #D1FAE5; color: #065F46; }
          .status.error { background: #FEE2E2; color: #991B1B; }
          .status.info { background: #DBEAFE; color: #1E40AF; }
          .results-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 12px;
          }
          .results-table th {
            background: #1F2937;
            color: white;
            padding: 8px;
            text-align: left;
            font-weight: bold;
            white-space: normal;
            vertical-align: bottom;
            min-width: 90px;
          }
          .results-table td {
            border: 1px solid #D1D5DB;
            padding: 4px;
            vertical-align: top;
          }
          .results-table input {
            width: 100%;
            border: none;
            background: transparent;
            font-size: 12px;
            padding: 4px;
            font-family: Arial, sans-serif;
          }
          .results-table input:focus {
            background: #FEF3C7;
            outline: 1px solid #D97706;
          }
          .results-table textarea {
            width: 100%;
            border: none;
            background: transparent;
            font-size: 12px;
            padding: 4px;
            font-family: Arial, sans-serif;
            resize: vertical;
            min-height: 60px;
          }
          .results-table textarea:focus {
            background: #FEF3C7;
            outline: 1px solid #D97706;
          }
          .results-table button {
            flex: none;
            padding: 4px 8px;
            font-size: 11px;
            background: #DC2626;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-family: Arial, sans-serif;
            font-weight: bold;
          }
          .results-table button:hover { background: #B91C1C; }
          .conf-high { background: #D1FAE5; }
          .conf-medium { background: #FEF3C7; }
          .conf-low { background: #FEE2E2; }
          .progress-bar-container {
            margin-top: 15px;
            background: #E5E7EB;
            border-radius: 4px;
            height: 24px;
            position: relative;
            overflow: hidden;
          }
          .progress-bar {
            height: 100%;
            background: #D97706;
            border-radius: 4px;
            transition: width 0.3s ease;
          }
          .progress-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 12px;
            font-weight: bold;
            color: #1F2937;
          }
          .help-btn {
            position: fixed;
            top: 1rem;
            right: 1.25rem;
            z-index: 1000;
            background: #1F2937;
            color: #D97706;
            display: inline-block;
            padding: 8px 16px;
            border-radius: 4px;
            font-family: Arial, sans-serif;
            font-weight: bold;
            font-size: 0.85rem;
            text-decoration: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            white-space: nowrap;
            letter-spacing: 0.03em;
          }
          .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 20px; }
          .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 16px; }
          .hint { font-size: 12px; color: #6B7280; margin-top: 4px; }
          h3 { color: #1F2937; margin: 18px 0 10px; font-size: 16px; }
          .review-section { background: white; border: 1px solid #D1D5DB; border-left: 4px solid #D97706; border-radius: 6px; margin-bottom: 14px; }
          .review-section > summary { cursor: pointer; padding: 12px 16px; font-weight: bold; color: #1F2937; font-size: 15px; }
          .section-note { font-weight: normal; color: #6B7280; font-size: 12px; margin-left: 10px; }
          .review-body { padding: 4px 16px 16px; }
          .sub-block { border-top: 1px dashed #D1D5DB; padding-top: 12px; margin-top: 12px; }
          .sec-head { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
          .sec-head input { font-weight: bold; }
          .cur-item { display: grid; grid-template-columns: 1fr 340px 36px; gap: 8px; margin-bottom: 8px; align-items: start; }
          .cur-item textarea { font-size: 12px; }
          .cur-rec { color: #B91C1C; }
          @media (max-width: 800px) { .cur-item { grid-template-columns: 1fr; } }
          button.btn-small, .btn-small { flex: none; display: inline-block; padding: 6px 12px; font-size: 12px; margin: 8px 8px 0 0; background: #1F2937; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
          button.btn-small.danger { background: #DC2626; margin: 0; }
          .btn-load { flex: 1; display: flex; align-items: center; justify-content: center; padding: 12px; font-size: 16px; font-weight: bold; background: #E5E7EB; color: #1F2937; border: 1px solid #9CA3AF; border-radius: 4px; cursor: pointer; margin: 0; }
          .step-list { list-style: none; padding: 0; margin: 12px 0 0; font-size: 13px; }
          .step-list li { display: flex; gap: 8px; padding: 3px 0; color: #1F2937; }
          .step-icon { width: 16px; text-align: center; font-weight: bold; }
          .step-detail { color: #6B7280; margin-left: auto; text-align: right; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .step-running .step-icon { color: #D97706; }
          .step-done .step-icon { color: #059669; }
          .step-error, .step-error .step-detail { color: #B91C1C; white-space: normal; }
          .step-skipped { color: #9CA3AF; }
          .help-btn:hover {
            background: #D97706;
            color: #1F2937;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
