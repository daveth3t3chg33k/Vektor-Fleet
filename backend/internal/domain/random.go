package domain

import "math"

// Rng is a deterministic pseudo-random generator (mulberry32).
//
// The demo dataset must be byte-identical on every boot and in every test run,
// so nothing in the platform may reach for math/rand's global source. Every
// generator call goes through an explicitly seeded Rng.
type Rng struct {
	state uint32
}

// NewRng returns a generator with the given seed.
func NewRng(seed uint32) *Rng {
	return &Rng{state: seed}
}

// Float returns a uniform value in [min, max).
func (r *Rng) Float(min, max float64) float64 {
	return min + r.next()*(max-min)
}

// Int returns a uniform integer in [min, max], inclusive.
func (r *Rng) Int(min, max int) int {
	if max < min {
		return min
	}
	return min + int(r.next()*float64(max-min+1))
}

// Int64 returns a uniform integer in [min, max], inclusive. Needed for values
// that exceed the range of a platform int, such as IMEIs.
func (r *Rng) Int64(min, max int64) int64 {
	if max < min {
		return min
	}
	return min + int64(r.next()*float64(max-min+1))
}

// Bool returns true with probability p.
func (r *Rng) Bool(p float64) bool {
	return r.next() < p
}

// Pick returns a uniformly chosen element. It panics on an empty slice, because
// a silently returning zero value would corrupt the fixture rather than fail loudly.
//
// Deliberately a package-level function rather than a method: generic methods are
// only permitted from Go 1.27, and keeping this a plain generic function lets the
// module stay buildable on the wider Go 1.21+ toolchain.
func Pick[T any](r *Rng, items []T) T {
	if len(items) == 0 {
		panic("domain.Pick: empty collection")
	}
	return items[int(r.next()*float64(len(items)))%len(items)]
}

// WeightedChoice is one option in a weighted draw.
type WeightedChoice[T any] struct {
	Value  T
	Weight float64
}

// Weighted draws from a weighted set. Weights need not sum to one.
func Weighted[T any](r *Rng, choices []WeightedChoice[T]) T {
	total := 0.0
	for _, c := range choices {
		total += c.Weight
	}
	roll := r.next() * total
	for _, c := range choices {
		roll -= c.Weight
		if roll <= 0 {
			return c.Value
		}
	}
	return choices[len(choices)-1].Value
}

// Shuffled returns up to count distinct elements in random order.
func Shuffled[T any](r *Rng, items []T, count int) []T {
	pool := make([]T, len(items))
	copy(pool, items)
	out := make([]T, 0, count)
	for len(out) < count && len(pool) > 0 {
		i := int(r.next() * float64(len(pool)))
		out = append(out, pool[i])
		pool = append(pool[:i], pool[i+1:]...)
	}
	return out
}

func (r *Rng) next() float64 {
	r.state += 0x6d2b79f5
	t := r.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64((t^(t>>14))>>0) / float64(1<<32)
}

// Round rounds to the given number of decimal places.
func Round(v float64, dp int) float64 {
	factor := math.Pow(10, float64(dp))
	return math.Round(v*factor) / factor
}
