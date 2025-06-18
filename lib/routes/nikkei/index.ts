import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/search/:keyword/:volume?',
    categories: ['traditional-media'],
    example: '/nikkei/search/がん治療',
    parameters: { 
        keyword: '搜索關鍵字，例如：がん治療、AI、経済等',
        volume: '結果數量，可選參數，預設為10'
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.nikkei.com/search'],
            target: '/search/:keyword',
        },
    ],
    name: '搜索',
    maintainers: ['你的GitHub用戶名'],
    handler,
    url: 'www.nikkei.com/search',
    description: '日本經濟新聞關鍵字搜索',
};

async function handler(ctx) {
    const keyword = ctx.req.param('keyword');
    const volume = ctx.req.param('volume') || '10';
    
    if (!keyword) {
        throw new Error('關鍵字參數是必需的');
    }

    const baseUrl = 'https://www.nikkei.com';
    const searchUrl = `${baseUrl}/search?keyword=${encodeURIComponent(keyword)}&volume=${volume}`;

    try {
        const response = await got({
            url: searchUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
                'Referer': baseUrl
            }
        });

        const $ = load(response.data);

        // 解析搜索結果
        let items = $('.m-miM04_item, .searchresult-item, [class*="searchResult"]')
            .toArray()
            .map((item) => {
                item = $(item);
                
                // 尋找標題和連結
                const titleElement = item.find('h3 a, .m-miM04_title a, a[class*="title"]').first();
                const title = titleElement.text().trim();
                const link = titleElement.attr('href');
                
                if (!title || !link) return null;
                
                const fullLink = link.startsWith('http') ? link : `${baseUrl}${link}`;
                
                // 尋找摘要
                const summary = item.find('.m-miM04_text, .searchresult-summary, [class*="summary"]').text().trim();
                
                // 尋找日期
                const dateElement = item.find('.m-miM04_date, .searchresult-date, [class*="date"]');
                const dateText = dateElement.text().trim();

                return {
                    title,
                    link: fullLink,
                    description: summary || title,
                    pubDate: dateText ? parseDate(dateText) : null,
                };
            })
            .filter(item => item !== null);

        // 如果沒有找到結果，嘗試其他選擇器
        if (items.length === 0) {
            items = $('article, .article-item, [class*="article"]')
                .toArray()
                .map((item) => {
                    item = $(item);
                    const titleElement = item.find('a').first();
                    const title = titleElement.text().trim();
                    const link = titleElement.attr('href');
                    
                    if (!title || !link) return null;
                    
                    const fullLink = link.startsWith('http') ? link : `${baseUrl}${link}`;
                    
                    return {
                        title,
                        link: fullLink,
                        description: title,
                    };
                })
                .filter(item => item !== null);
        }

        // 獲取詳細內容（可選，如果需要完整文章內容）
        const detailedItems = await Promise.all(
            items.slice(0, parseInt(volume)).map((item) =>
                cache.tryGet(item.link, async () => {
                    try {
                        const detailResponse = await got({
                            url: item.link,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Referer': baseUrl
                            }
                        });

                        const content = load(detailResponse.data);
                        
                        // 提取文章內容
                        const articleContent = content('section[class^=container_], .article-body, [class*="content"]').html();
                        if (articleContent) {
                            item.description = articleContent;
                        }
                        
                        // 提取發布時間
                        const pubTime = content('meta[property="article:published_time"]').attr('content');
                        if (pubTime) {
                            item.pubDate = parseDate(pubTime);
                        }
                        
                        // 提取作者
                        const author = content('meta[property="author"], .author, [class*="author"]').attr('content') || 
                                     content('.author, [class*="author"]').text().trim();
                        if (author) {
                            item.author = author;
                        }

                        return item;
                    } catch (error) {
                        console.error(`Error fetching details for ${item.link}:`, error);
                        return item;
                    }
                })
            )
        );

        return {
            title: `日本経済新聞 - 搜索: ${keyword}`,
            link: searchUrl,
            description: `搜索關鍵字「${keyword}」的結果`,
            item: detailedItems,
        };

    } catch (error) {
        console.error('Nikkei search error:', error);
        throw new Error(`無法搜索日經新聞內容: ${error.message}`);
    }
}
