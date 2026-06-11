// backend/internal/migrate/migrate_test.go
package migrate_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/migrate"
)

func TestListMigrations_OrderedAndFiltered(t *testing.T) {
	dir := t.TempDir()

	os.WriteFile(filepath.Join(dir, "002_second.sql"), []byte("SELECT 2"), 0644)
	os.WriteFile(filepath.Join(dir, "001_first.sql"), []byte("SELECT 1"), 0644)
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("ignore me"), 0644)

	files, err := migrate.ListFiles(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
	if files[0] != "001_first.sql" {
		t.Errorf("first file: got %q, want %q", files[0], "001_first.sql")
	}
	if files[1] != "002_second.sql" {
		t.Errorf("second file: got %q, want %q", files[1], "002_second.sql")
	}
}
