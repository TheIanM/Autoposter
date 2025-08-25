// autoposter.js
const Parser = require('rss-parser');
const { BskyAgent } = require('@atproto/api');
const fs = require('fs').promises;
const path = require('path');

const parser = new Parser();
const agent = new BskyAgent({
  service: 'https://bsky.social'
});

// File to track posted items
const POSTED_ITEMS_FILE = 'posted-items.json';

async function loadPostedItems() {
  try {
    const data = await fs.readFile(POSTED_ITEMS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist yet, return empty array
    return [];
  }
}

async function savePostedItems(items) {
  await fs.writeFile(POSTED_ITEMS_FILE, JSON.stringify(items, null, 2));
}

function truncateText(text, maxLength = 280) {
  if (text.length <= maxLength) return text;
  
  // Find last complete word before the limit
  const truncated = text.substring(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  
  return truncated.substring(0, lastSpace) + '...';
}

function createBlueskyPost(item) {
  const title = item.title || '';
  const link = item.link || '';
  const description = item.contentSnippet || item.content || '';
  
  // Clean up description (remove HTML, extra whitespace)
  const cleanDescription = description
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Simpler format - just title and link, let Bluesky handle the preview
  let postText = `📝 New blog post: ${title}`;
  
  // Add a short description if available and not too long
  if (cleanDescription && cleanDescription.length < 150) {
    postText += `\n\n${cleanDescription}`;
  }
  
  // Add link on its own line for better link card detection
  postText += `\n\n${link}`;
  
  return postText;
}

async function main() {
  try {
    const rssUrl = process.env.WORDPRESS_RSS_URL;
    const blueskyHandle = process.env.BLUESKY_HANDLE;
    const blueskyPassword = process.env.BLUESKY_APP_PASSWORD;
    
    if (!rssUrl || !blueskyHandle || !blueskyPassword) {
      throw new Error('Missing required environment variables');
    }
    
    console.log('Checking RSS feed:', rssUrl);
    
    // Parse RSS feed
    const feed = await parser.parseURL(rssUrl);
    
    // Load previously posted items
    const postedItems = await loadPostedItems();
    console.log(`Previously posted: ${postedItems.length} items`);
    
    // Find new items (not in posted list)
    const newItems = feed.items.filter(item => {
      return !postedItems.some(posted => posted.guid === item.guid || posted.link === item.link);
    });
    
    console.log(`Found ${newItems.length} new items`);
    
    if (newItems.length === 0) {
      console.log('No new posts to share');
      return;
    }
    
    // Login to Bluesky
    console.log('Logging into Bluesky...');
    await agent.login({
      identifier: blueskyHandle,
      password: blueskyPassword,
    });
    
    // Post new items (limit to prevent spam)
    const itemsToPost = newItems.slice(0, 3); // Max 3 posts per run
    
    for (const item of itemsToPost) {
      try {
        const postText = createBlueskyPost(item);
        
        console.log(`Posting: ${item.title}`);
        console.log(`Text: ${postText}`);
        
        await agent.post({
          text: postText,
          createdAt: new Date().toISOString(),
        });
        
        // Add to posted items
        postedItems.push({
          guid: item.guid,
          link: item.link,
          title: item.title,
          postedAt: new Date().toISOString()
        });
        
        console.log('✅ Posted successfully');
        
        // Wait a bit between posts to be nice to the API
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`Failed to post "${item.title}":`, error.message);
      }
    }
    
    // Save updated posted items list
    await savePostedItems(postedItems);
    console.log('Updated posted items list');
    
  } catch (error) {
    console.error('Script failed:', error.message);
    process.exit(1);
  }
}

main();
