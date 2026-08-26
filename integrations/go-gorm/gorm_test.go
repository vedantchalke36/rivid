// GORM integration for ULID primary keys on PostgreSQL.
//
// HONESTY NOTE: no rivid-go binding exists yet; generation uses oklog/ulid
// v2 (identical 128-bit layout). Persistence semantics tested here are
// generator-agnostic — swap newULID() when rivid-go ships.
//
// Idiomatic Rivid exposure: the ULID type implements driver.Valuer and
// sql.Scanner so models declare `ID ULID \`gorm:"primaryKey;size:26"\“
// and application code stays `db.Create(&User{Email: ...})` with GORM's
// BeforeCreate hook filling the ID.
package main

import (
	"crypto/rand"
	"fmt"
	"os"
	"testing"
	"time"

	"database/sql/driver"

	oklog "github.com/oklog/ulid/v2"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type ULID string

func (u ULID) Value() (driver.Value, error) { return string(u), nil }
func (u *ULID) Scan(src any) error {
	switch s := src.(type) {
	case string:
		*u = ULID(s)
	case []byte:
		*u = ULID(s)
	default:
		return fmt.Errorf("unsupported scan type %T", src)
	}
	return nil
}

func NewULID(t time.Time) ULID {
	return ULID(oklog.MustNew(oklog.Timestamp(t), rand.Reader).String())
}

type User struct {
	ID        ULID `gorm:"primaryKey;size:26;column:id"`
	Email     string
	Name      string
	CreatedAt time.Time
}

func (User) TableName() string { return "users_ulid_gorm" }

func openDB(t testing.TB) *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:bench@localhost:54329/ids?sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&User{}); err != nil {
		t.Fatal(err)
	}
	return db
}

// mode A equivalent: hook fills ID via our generator, idiomatic Create.
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = NewULID(time.Now())
	}
	return nil
}

func TestGORMCRUDAndDefaults(t *testing.T) {
	db := openDB(t)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	u := User{Email: "g@x.io", Name: "G"}
	if err := db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	if len(u.ID) != 26 {
		t.Fatalf("hook did not fill valid ULID: %q", u.ID)
	}
	var got User
	if err := db.First(&got, "id = ?", u.ID).Error; err != nil || got.Email != "g@x.io" {
		t.Fatalf("fetch failed: %v", err)
	}
	db.Model(&User{}).Where("id = ?", u.ID).Update("name", "G2")
	var upd User
	db.First(&upd, "id = ?", u.ID)
	if upd.Name != "G2" {
		t.Fatal("update failed")
	}
	db.Delete(&User{}, "id = ?", u.ID)
	var n int64
	db.Model(&User{}).Where("id = ?", u.ID).Count(&n)
	if n != 0 {
		t.Fatal("delete failed")
	}
}

func TestGORMLimitOffsetVsKeyset(t *testing.T) {
	db := openDB(t)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	const N = 1000
	var prev ULID
	for i := 0; i < N; i++ {
		now := time.Now()
		id := NewULID(now)
		if id <= prev { // enforce monotonic within same ms like rivid would
			time.Sleep(time.Millisecond)
			id = NewULID(time.Now())
		}
		prev = id
		if err := db.Create(&User{ID: id, Email: fmt.Sprintf("k%d@x.io", i), Name: "K"}).Error; err != nil {
			t.Fatal(err)
		}
	}

	cursor := ""
	seen := map[ULID]bool{}
	for {
		var page []User
		q := db.Where("email LIKE ? AND id > ?", "k%@x.io", cursor).Order("id").Limit(200)
		if err := q.Find(&page).Error; err != nil {
			t.Fatal(err)
		}
		if len(page) == 0 {
			break
		}
		for _, p := range page {
			seen[p.ID] = true
			cursor = string(p.ID)
		}
	}
	if len(seen) != N {
		t.Fatalf("keyset pagination saw %d want %d", len(seen), N)
	}
	db.Where("email LIKE ?", "k%@x.io").Delete(&User{})
}

func TestGORMTransactionRollback(t *testing.T) {
	db := openDB(t)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	err := db.Transaction(func(tx *gorm.DB) error {
		tx.Create(&User{Email: "rb@x.io", Name: "RB"})
		return fmt.Errorf("force rollback")
	})
	if err == nil {
		t.Fatal("expected rollback error")
	}
	var n int64
	db.Model(&User{}).Where("email = ?", "rb@x.io").Count(&n)
	if n != 0 {
		t.Fatalf("rollback leaked %d", n)
	}
}
