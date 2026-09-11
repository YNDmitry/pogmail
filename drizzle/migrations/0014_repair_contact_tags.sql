-- Some local schemas created from the former Drizzle array default stored the
-- literal column name in this field. Normalize every legacy value before JSON
-- decoding resumes in the application.
UPDATE `contacts`
SET `tags` = CASE
	WHEN json_valid(`tags`) THEN CASE WHEN json_type(`tags`) = 'array' THEN `tags` ELSE '[]' END
	ELSE '[]'
END;
