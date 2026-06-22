INSERT OR IGNORE INTO factory_bots (bot_id, bot_name, slug, bot_kind, config_json, meta_phone_number_id, system_prompt, welcome_message, menu_json)
VALUES ('taller_001', 'Taller Titanium', 'taller-titanium', 'agendado', '{
  "business_identity": {
    "name": "Taller Titanium",
    "welcome_message": "🔱 Bienvenido al Taller Titanium...",
    "location_label": "Autodiagnóstico JR"
  },
  "scheduling": {
    "capacity_per_slot": 6,
    "slot_duration_minutes": 30,
    "booking_horizon_days": 14
  },
  "office_hours": {
    "work_days": [false, true, true, true, true, true, false],
    "open_hour": 7,
    "close_hour": 18,
    "timezone": "America/Caracas"
  },
  "steps": [
    { "id": "vehiculo", "type": "select", "label": "🚗 Vehículo", "prompt": "Selecciona el vehículo", "options": [{"label":"Sedán","value":"sedan"}] },
    { "id": "fecha", "type": "date", "label": "📅 Fecha", "prompt": "Selecciona fecha" }
  ],
  "cancel_keywords": ["cancelar"],
  "help_keywords": ["ayuda"]
}', '1092822373921606', '', '', '[]');
