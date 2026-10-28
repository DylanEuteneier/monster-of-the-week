//! A fixed-capacity list of small ids, kept inline (no heap): the factions at a location, a location's neighbours, a
//! hand. Copying one is a plain memory copy. It derefs to a slice, so it reads like one.

use std::ops::{Deref, DerefMut};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct List<T: Copy + Default, const N: usize> {
    len: u8,
    items: [T; N],
}

/// A list of small ids (u8).
pub type Small<const N: usize> = List<u8, N>;

impl<T: Copy + Default, const N: usize> Default for List<T, N> {
    fn default() -> Self {
        List { len: 0, items: [T::default(); N] }
    }
}

impl<T: Copy + Default + std::fmt::Debug, const N: usize> std::fmt::Debug for List<T, N> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<T: Copy + Default + PartialEq, const N: usize> List<T, N> {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }
    #[inline]
    pub fn push(&mut self, x: T) {
        debug_assert!((self.len as usize) < N, "List<{N}> is full");
        self.items[self.len as usize] = x;
        self.len += 1;
    }
    /// Push unless already present (a Set's add, keeping insertion order).
    #[inline]
    pub fn add(&mut self, x: T) {
        if !self.contains(&x) {
            self.push(x);
        }
    }
    #[inline]
    pub fn retain(&mut self, mut keep: impl FnMut(T) -> bool) {
        let mut j = 0;
        for i in 0..self.len as usize {
            let x = self.items[i];
            if keep(x) {
                self.items[j] = x;
                j += 1;
            }
        }
        self.len = j as u8;
    }
    #[inline]
    pub fn remove(&mut self, i: usize) -> T {
        let x = self.items[i];
        self.items.copy_within(i + 1..self.len as usize, i);
        self.len -= 1;
        x
    }
    #[inline]
    pub fn insert(&mut self, i: usize, x: T) {
        let n = self.len as usize;
        self.items.copy_within(i..n, i + 1);
        self.items[i] = x;
        self.len += 1;
    }
    #[inline]
    pub fn clear(&mut self) {
        self.len = 0;
    }
    pub fn from_slice(xs: &[T]) -> Self {
        let mut s = Self::default();
        for &x in xs {
            s.push(x);
        }
        s
    }
    #[inline]
    pub fn to_vec(&self) -> Vec<T> {
        self.deref().to_vec()
    }
}

impl<T: Copy + Default, const N: usize> Deref for List<T, N> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        &self.items[..self.len as usize]
    }
}

impl<T: Copy + Default, const N: usize> DerefMut for List<T, N> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.items[..self.len as usize]
    }
}

impl<T: Copy + Default, const N: usize> IntoIterator for List<T, N> {
    type Item = T;
    type IntoIter = std::iter::Take<std::array::IntoIter<T, N>>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        let n = self.len as usize;
        self.items.into_iter().take(n)
    }
}

impl<'a, T: Copy + Default, const N: usize> IntoIterator for &'a List<T, N> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.deref().iter()
    }
}

impl<T: Copy + Default + PartialEq, const N: usize> FromIterator<T> for List<T, N> {
    fn from_iter<I: IntoIterator<Item = T>>(it: I) -> Self {
        let mut s = Self::default();
        for x in it {
            s.push(x);
        }
        s
    }
}

impl<T: Copy + Default + PartialEq, const N: usize> Extend<T> for List<T, N> {
    fn extend<I: IntoIterator<Item = T>>(&mut self, it: I) {
        for x in it {
            self.push(x);
        }
    }
}

impl<T: Copy + Default + PartialEq, const N: usize> PartialEq<Vec<T>> for List<T, N> {
    fn eq(&self, other: &Vec<T>) -> bool {
        self.deref() == other.as_slice()
    }
}

impl<T: Copy + Default + PartialEq, const N: usize> From<Vec<T>> for List<T, N> {
    fn from(v: Vec<T>) -> Self {
        Self::from_slice(&v)
    }
}
