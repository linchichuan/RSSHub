import { Route } from '@/types';
import got from '@/utils/got';
import { load } from 'cheerio';

export const route: Route = {
    path: '/index/:keyword?',
    name: 'Home',
    example: '/nikkei/index/cancer',
    parameters: { 
        keyword: '關鍵字搜索，可選參數。例如：cancer、AI、economy 等' 
    },
    maintainers: ['zjysdhr'],
    handler,
    url: 'www.nikkei.com',
    description: '日本經濟新聞首頁，支援關鍵字過濾',
};

async function handler(ctx) {
    const keyword = ctx.req.param('keyword');
    const url = 'https://www.nikkei.com';
    const response = await got(url);
    const $ = load(response.data);

    let list = $('a[data-rn-inview-track-value]')
        .toArray()
        .map((e) => {
            e = $(e);
            const data = e.data('rn-track-value');
            const title = data.title;
            const link = `${url}/article/${data.kiji_id_raw}/`;

            const parent = e.parent();
            const img = parent.find('img[class^=image_]');
            const imgSrc = img.attr('src');
            const imgAlt = img.attr('alt');

            const desc = `<img src="${imgSrc}" alt="${imgAlt}">` + (parent.find('[class^=excerptContainer]').length ? parent.find('[class^=excerptContainer]').html() : '');

            return {
                title,
                description: desc,
                link,
            };
        });

    // 如果有關鍵字，進行過濾
    if (keyword) {
        list = list.filter(item => {
            const titleMatch = item.title && item.title.toLowerCase().includes(keyword.toLowerCase());
            const descMatch = item.description && item.description.toLowerCase().includes(keyword.toLowerCase());
            return titleMatch || descMatch;
        });
    }

    const titleSuffix = keyword ? ` - ${keyword}` : '';

    return {
        title: `日本経済新聞${titleSuffix}`,
        link: url,
        item: list,
    };
}
