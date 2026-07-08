import axios from 'axios';

const url = 'https://www.reddit.com/r/classicliterature/comments/1iz5e8k/sad_to_report_i_just_finished_count_of_monte/';

const res = await axios.get(`https://r.jina.ai/${url}`, {
  timeout: 10000,
  headers: { 'Accept': 'text/plain' },
  responseType: 'text',
});

console.log('Status:', res.status);
console.log('Length:', (res.data as string).length, 'chars');
console.log('---FULL RESPONSE---');
console.log(res.data);
console.log('---END---');
