import sqlite3
import json

def migrate():
    # Connect to the source OBD database
    src_conn = sqlite3.connect('sqlODB/obd_codes.db')
    src_cursor = src_conn.cursor()

    # Get all codes from the source (group by code to avoid unique constraint issues)
    src_cursor.execute("SELECT code, description, source, extra_metadata FROM dtc_codes GROUP BY code")
    rows = src_cursor.fetchall()

    # Prepare SQL for D1
    print("-- Migration SQL for D1")
    print("DELETE FROM factory_obd_codes;")

    for row in rows:
        code, description, source, extra_metadata = row
        # Sanitize and format for D1 INSERT
        payload = {
            "code": code,
            "description": description,
            "source": source,
            "extra_metadata": extra_metadata
        }
        payload_json = json.dumps(payload).replace("'", "''")
        description_esc = description.replace("'", "''")

        sql = f"INSERT INTO factory_obd_codes (code, description, payload_json) VALUES ('{code}', '{description_esc}', '{payload_json}');"
        print(sql)

    src_conn.close()

if __name__ == "__main__":
    migrate()
