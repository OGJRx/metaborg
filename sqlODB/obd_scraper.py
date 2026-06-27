import time
import requests
import json
import sqlite3
import logging
import os
import pandas as pd
from urllib.parse import urlparse
from bs4 import BeautifulSoup

# Logging setup
logging.basicConfig(
    filename='scraping_log.txt',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class OBDScraper:
    def __init__(self, db_path='obd_codes.db'):
        self.db_path = db_path
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        self.last_request_time = 0
        self.last_domain = None
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.user_agent})
        self.start_time = time.time()
        self.stats = {}

    def init_db(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS dtc_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            description TEXT NOT NULL,
            source TEXT NOT NULL,
            raw_hex TEXT,
            raw_decimal INTEGER,
            extra_metadata TEXT,
            retrieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, source)
        )
        ''')
        cursor.execute('DROP VIEW IF EXISTS best_dtc')
        cursor.execute('''
        CREATE VIEW best_dtc AS
        WITH prioritized AS (
            SELECT code, description,
                   ROW_NUMBER() OVER (
                       PARTITION BY code
                       ORDER BY CASE source
                           WHEN 'gist' THEN 1
                           WHEN 'carapi' THEN 2
                           WHEN 'klavkarr' THEN 3
                           WHEN 'autoxuga' THEN 4
                           WHEN 'fieldlogix' THEN 5
                           ELSE 6
                       END, retrieved_at DESC
                   ) as rn
            FROM dtc_codes
        ),
        sources AS (
            SELECT code, GROUP_CONCAT(DISTINCT source) as sources_available
            FROM dtc_codes
            GROUP BY code
        )
        SELECT p.code, p.description as best_description, s.sources_available
        FROM prioritized p
        JOIN sources s ON p.code = s.code
        WHERE p.rn = 1;
        ''')
        conn.commit()
        conn.close()

    def wait_if_needed(self, url):
        now = time.time()
        domain = urlparse(url).netloc
        if self.last_domain:
            wait_time = 8 if self.last_domain == domain else 15
            elapsed = now - self.last_request_time
            if elapsed < wait_time:
                time.sleep(wait_time - elapsed)
        self.last_request_time = time.time()
        self.last_domain = domain

    def get(self, url, retries=2):
        self.wait_if_needed(url)
        for i in range(retries + 1):
            try:
                response = self.session.get(url, timeout=30)
                if response.status_code == 200:
                    return response
                logging.warning(f"HTTP {response.status_code} for {url}")
                if response.status_code in [429, 500, 502, 503, 504]:
                    time.sleep(10 * (i + 1))
                    continue
                return response
            except Exception as e:
                logging.error(f"Error {url}: {e}")
                time.sleep(10 * (i + 1))
        return None

    def save_codes(self, codes_data):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        count = 0
        for data in codes_data:
            try:
                cursor.execute('''
                INSERT OR IGNORE INTO dtc_codes (code, description, source, raw_hex, raw_decimal, extra_metadata)
                VALUES (?, ?, ?, ?, ?, ?)
                ''', (data['code'], data['description'], data['source'], data.get('raw_hex'),
                      data.get('raw_decimal'), json.dumps(data.get('extra_metadata')) if data.get('extra_metadata') else None))
                if cursor.rowcount > 0: count += 1
            except: pass
        conn.commit()
        conn.close()
        return count

    def scrape_gist(self):
        url = "https://gist.githubusercontent.com/wzr1337/8af2731a5ffa98f9d506537279da7a0e/raw/a273cf7ee48ba98318e04a6cd667d0de1eb28ad0/dtcmapping.json"
        logging.info("Source: Gist - Starting")
        resp = self.get(url)
        if resp and resp.status_code == 200:
            data = resp.json()
            codes = [{'code': k, 'description': v, 'source': 'gist'} for k, v in data.items() if v]
            saved = self.save_codes(codes)
            self.stats['gist'] = saved
            logging.info(f"Source: Gist - Extracted: {len(codes)}, Saved: {saved}")

    def scrape_carapi(self):
        url = "https://carapi.app/api/obd-codes"
        logging.info("Source: CarAPI - Starting")
        resp = self.get(f"{url}?page=1")
        if not resp or resp.status_code != 200:
            logging.warning("Source: CarAPI - Auth required or error")
            self.stats['carapi'] = 0
            return
        data = resp.json()
        total_pages = data.get('collection', {}).get('total', 1)
        total_saved = 0
        for p in range(1, total_pages + 1):
            if p > 1:
                resp = self.get(f"{url}?page={p}")
                if not resp or resp.status_code != 200: break
                data = resp.json()
            codes = [{'code': i['code'], 'description': i['description'], 'source': 'carapi'} for i in data.get('data', [])]
            total_saved += self.save_codes(codes)
        self.stats['carapi'] = total_saved
        logging.info(f"Source: CarAPI - Saved: {total_saved}")

    def scrape_klavkarr(self):
        logging.info("Source: Klavkarr - Starting basic ranges")
        ranges = ["p0000-p0299", "p0300-p0399", "p0400-p0499", "p0500-p0599", "p0600-p0699", "p0700-p0999"]
        total_saved = 0
        for r in ranges:
            resp = self.get(f"https://www.klavkarr.com/data-trouble-code-obd2.php?dtc={r}")
            if not resp or resp.status_code != 200: continue
            soup = BeautifulSoup(resp.text, 'html.parser')
            codes = []
            for table in soup.find_all('table'):
                for row in table.find_all('tr'):
                    cols = row.find_all('td')
                    if len(cols) >= 2:
                        codes.append({'code': cols[0].get_text(strip=True), 'description': cols[1].get_text(strip=True), 'source': 'klavkarr'})
            total_saved += self.save_codes(codes)
        self.stats['klavkarr'] = total_saved
        logging.info(f"Source: Klavkarr - Saved: {total_saved}")

    def scrape_autoxuga(self):
        url = "https://www.autoxuga.net/cursos/averiasp.php"
        logging.info("Source: AutoXuga - Starting")
        resp = self.get(url)
        if not resp or resp.status_code != 200: return
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = soup.find('table')
        if not table: return
        codes = []
        for row in table.find_all('tr'):
            cols = row.find_all('td')
            if len(cols) >= 4 and "Codigo OBD" not in cols[0].text:
                try: d = int(cols[1].text.strip())
                except: d = None
                codes.append({'code': cols[0].text.strip(), 'description': cols[3].text.strip(), 'source': 'autoxuga', 'raw_hex': cols[2].text.strip(), 'raw_decimal': d})
        saved = self.save_codes(codes)
        self.stats['autoxuga'] = saved
        logging.info(f"Source: AutoXuga - Saved: {saved}")

    def scrape_fieldlogix(self):
        url = "https://fieldlogix.com/tools/dtc-codes-lookup-tool/"
        logging.info("Source: FieldLogix - Starting")
        resp = self.get(url)
        if not resp or resp.status_code != 200: return
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = soup.find('table')
        if not table: return
        codes = []
        for row in table.find_all('tr'):
            cols = row.find_all('td')
            if len(cols) >= 3:
                codes.append({'code': cols[1].get_text(strip=True), 'description': cols[2].get_text(strip=True), 'source': 'fieldlogix', 'extra_metadata': {'type': cols[0].get_text(strip=True)}})
        saved = self.save_codes(codes)
        self.stats['fieldlogix'] = saved
        logging.info(f"Source: FieldLogix - Saved: {saved}")

    def run(self):
        self.init_db()
        self.scrape_gist()
        self.scrape_carapi()
        self.scrape_klavkarr()
        self.scrape_autoxuga()
        self.scrape_fieldlogix()

        # Export CSV
        conn = sqlite3.connect(self.db_path)
        df = pd.read_sql('SELECT * FROM best_dtc', conn)
        df.to_csv('mejores_descripciones.csv', index=False)

        # Report
        cursor = conn.cursor()
        cursor.execute('SELECT count(DISTINCT code) FROM dtc_codes')
        total_unique = cursor.fetchone()[0]
        conn.close()

        duration = time.time() - self.start_time
        logging.info(f"Scraping finished. Total unique codes: {total_unique}. Total time: {duration:.2f}s")

        print(f"\n--- RESUMEN FINAL ---")
        print(f"Total de códigos únicos: {total_unique}")
        print(f"Cobertura SAE: {(total_unique/11000)*100:.2f}%")
        print(f"Tiempo total: {duration/60:.2f} minutos")
        print(f"Archivos generados: {self.db_path}, mejores_descripciones.csv, scraping_log.txt")

if __name__ == "__main__":
    scraper = OBDScraper()
    scraper.run()
