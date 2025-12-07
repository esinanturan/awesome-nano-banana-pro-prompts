import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import { createPrompt } from './utils/cms-client.js';
import { uploadImageToCMS } from './utils/image-uploader.js';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

interface IssueFields {
  prompt_title?: string;
  prompt?: string;
  description?: string;
  image_urls?: string;
  author_name?: string;
  author_link?: string;
  source_link?: string;
  language?: string;
}

// 语言名称到语言代码的映射
const LANGUAGE_MAP: Record<string, string> = {
  'English': 'en',
  'Chinese (中文)': 'zh',
  'Traditional Chinese (繁體中文)': 'zh-TW',
  'Japanese (日本語)': 'ja-JP',
  'Korean (한국어)': 'ko-KR',
  'Thai (ไทย)': 'th-TH',
  'Vietnamese (Tiếng Việt)': 'vi-VN',
  'Hindi (हिन्दी)': 'hi-IN',
  'Spanish (Español)': 'es-ES',
  'Latin American Spanish (Español Latinoamérica)': 'es-419',
  'German (Deutsch)': 'de-DE',
  'French (Français)': 'fr-FR',
  'Italian (Italiano)': 'it-IT',
  'Brazilian Portuguese (Português do Brasil)': 'pt-BR',
  'European Portuguese (Português)': 'pt-PT',
  'Turkish (Türkçe)': 'tr-TR',
};

function parseLanguage(languageName: string): string {
  return LANGUAGE_MAP[languageName] || 'en';
}

async function parseIssue(issueBody: string): Promise<IssueFields> {
  const fields: Record<string, string> = {};
  const lines = issueBody.split('\n');

  let currentField: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (currentField) {
        fields[currentField] = currentValue.join('\n').trim();
      }
      currentField = line.replace('### ', '').toLowerCase().replace(/\s+/g, '_');
      currentValue = [];
    } else if (currentField) {
      currentValue.push(line);
    }
  }

  if (currentField) {
    fields[currentField] = currentValue.join('\n').trim();
  }

  return fields;
}

async function main() {
  try {
    const issueNumber = process.env.ISSUE_NUMBER;
    const issueBody = process.env.ISSUE_BODY || '';

    if (!issueNumber) {
      throw new Error('ISSUE_NUMBER not provided');
    }

    // 获取 Issue 信息以检查标签
    const issue = await octokit.issues.get({
      owner: process.env.GITHUB_REPOSITORY?.split('/')[0] || '',
      repo: process.env.GITHUB_REPOSITORY?.split('/')[1] || '',
      issue_number: parseInt(issueNumber),
    });

    // 检查是否有 prompt-submission 标签
    const hasPromptSubmissionLabel = issue.data.labels.some(
      (label) => {
        const labelName = typeof label === 'string' ? label : label.name;
        return labelName === 'prompt-submission';
      }
    );

    if (!hasPromptSubmissionLabel) {
      console.log('⏭️ Skipping: Issue does not have "prompt-submission" label');
      process.exit(0);
    }

    console.log(`📋 Processing approved issue #${issueNumber}...`);

    const fields = await parseIssue(issueBody);

    // 解析多张图片 URL（每行一个）
    const imageUrls = (fields.image_urls || '')
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    console.log(`📸 Uploading ${imageUrls.length} image(s) to CMS...`);
    const uploadedImages = await Promise.all(
      imageUrls.map(url => uploadImageToCMS(url))
    );

    console.log('📝 Creating prompt in CMS (no draft)...');
    const prompt = await createPrompt({
      title: fields.prompt_title || '',
      content: fields.prompt || '',
      description: fields.description || '',
      sourceLink: fields.source_link || '',
      sourceMedia: uploadedImages,
      author: {
        name: fields.author_name || '',
        link: fields.author_link || '',
      },
      language: parseLanguage(fields.language || 'English'),
      sourcePublishedAt: issue.data.created_at,
      sourceMeta: {
        github_issue: issueNumber,
      },
    });

    console.log(`✅ Created prompt in CMS: ${prompt?.id}`);

    // Close the issue
    await octokit.issues.update({
      owner: process.env.GITHUB_REPOSITORY?.split('/')[0] || '',
      repo: process.env.GITHUB_REPOSITORY?.split('/')[1] || '',
      issue_number: parseInt(issueNumber),
      state: 'closed',
    });

    console.log(`✅ Closed issue #${issueNumber}`);

  } catch (error) {
    console.error('❌ Error syncing approved issue:', error);
    process.exit(1);
  }
}

main();
