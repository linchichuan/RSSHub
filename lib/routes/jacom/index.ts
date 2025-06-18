import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/:category?',
    categories: ['traditional-media'],
    example: '/jacom/kome',
    parameters: { 
        category: '分類，如：kome（米）、yasai（野菜）等，預設為 kome' 
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
            source: ['jacom.or.jp/:category/', 'jacom.or.jp/'],
            target: '/:category',
        },
    ],
    name: '新聞分類',
    maintainers: ['你的GitHub用戶名'],
    handler,
    url: 'jacom.or.jp',
    description: 'JA.com 農業協同組合新聞各分類訂閱',
};

async function handler(ctx) {
    const category = ctx.req.param('category') ?? 'kome';
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 20;

    const baseUrl = 'https://www.jacom.or.jp';
    const categoryUrl = `${baseUrl}/${category}/`;

    try {
        const response = await got({
            url: categoryUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
                'Referer': baseUrl
            }
        });

        const $ = load(response.data);

        // 根據網頁結構解析新聞列表
        let items = $('.article-list .article-item, .news-list .news-item, .content-area .item')
            .toArray()
            .slice(0, limit)
            .map((item) => {
                item = $(item);
                
                // 尋找標題和連結
                const titleElement = item.find('h2 a, h3 a, .title a, a').first();
                const title = titleElement.text().trim();
                const link = titleElement.attr('href');
                
                if (!title || !link) return null;
                
                const fullLink = link.startsWith('http') ? link : `${baseUrl}${link}`;
                
                // 尋找日期
                const dateElement = item.find('.date, .time, .publish-date, time');
                const dateText = dateElement.text().trim();
                
                // 尋找分類標籤
                const categoryElement = item.find('.category, .tag, .label');
                const categoryText = categoryElement.text().trim();

                return {
                    title,
                    link: fullLink,
                    pubDate: dateText ? parseDate(dateText) : null,
                    category: categoryText ? [categoryText] : [],
                };
            })
            .filter(item => item !== null);

        // 如果上述選擇器沒有找到內容，嘗試其他可能的選擇器
        if (items.length === 0) {
            // 根據你提供的搜索結果，嘗試解析具體的結構
            items = $('body')
                .find('*')
                .filter(function() {
                    const text = $(this).text();
                    return text.includes('2025年') && text.includes('月') && text.includes('日');
                })
                .toArray()
                .slice(0, limit)
                .map((item) => {
                    item = $(item);
                    const text = item.text().trim();
                    
                    // 解析標題和日期
                    const dateMatch = text.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
                    const date = dateMatch ? dateMatch[1] : null;
                    
                    // 移除日期後的文字作為標題
                    const title = date ? text.replace(date, '').trim() : text;
                    
                    // 尋找相關連結
                    const linkElement = item.find('a').first();
                    const link = linkElement.attr('href');
                    const fullLink = link ? (link.startsWith('http') ? link : `${baseUrl}${link}`) : categoryUrl;

                    return {
                        title: title || '無標題',
                        link: fullLink,
                        pubDate: date ? parseDate(date, 'YYYY年MM月DD日') : null,
                        description: text,
                    };
                })
                .filter(item => item.title !== '無標題');
        }

        // 獲取詳細內容
        const detailedItems = await Promise.all(
            items.map((item) =>
                cache.tryGet(item.link, async () => {
                    try {
                        if (item.link === categoryUrl) {
                            // 如果沒有具體連結，直接返回
                            return item;
                        }

                        const detailResponse = await got({
                            url: item.link,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Referer': categoryUrl
                            }
                        });

                        const content = load(detailResponse.data);
                        
                        // 提取文章內容
                        const articleContent = content('.article-content, .content, .main-content, .post-content').html();
                        if (articleContent) {
                            item.description = articleContent;
                        }
                        
                        // 提取更精確的發布時間
                        const pubTime = content('meta[property="article:published_time"]').attr('content') ||
                                       content('.publish-date, .date, time').attr('datetime');
                        if (pubTime) {
                            item.pubDate = parseDate(pubTime);
                        }
                        
                        // 提取作者
                        const author = content('.author, .writer, .byline').text().trim();
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
            title: `JA.com 農業協同組合新聞 - ${category}`,
            link: categoryUrl,
            description: `JA.com ${category} 分類新聞`,
            item: detailedItems,
        };

    } catch (error) {
        console.error('JACOM route error:', error);
        throw new Error(`無法獲取 JACOM 新聞內容: ${error.message}`);
    }
}
