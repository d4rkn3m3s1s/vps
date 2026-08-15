#!/bin/bash
# Bozuk rehber kaydi onarimi: isim "+numara" formatinda AMA telefon numarasi
# ISIMDEKINDEN FARKLI olan data satirlarini siler. Kok: eski ensureContacts
# raw_contact id'sini "_id DESC" ile TAHMIN ediyordu -> numara yanlis kisinin
# kaydina yaziliyordu -> WhatsApp o kisiyi guvenilmez sayip medyayi INDIRMIYORDU.
# Gercek isimli kisilere (Efe, Ahmet...) DOKUNMAZ (yalnizca '+' ile baslayan isimler).
IP="$1"
Q=$(adb -s "$IP":5555 shell 'content query --uri content://com.android.contacts/data --projection _id:display_name:data1 --where "mimetype=\"vnd.android.cursor.item/phone_v2\"" 2>/dev/null' 2>/dev/null | tr -d '\r')
SIL=$(echo "$Q" | awk -F'_id=|, display_name=|, data1=' '{id=$2; gsub(/,.*/,"",id); nm=$3; d1=$4; if(nm !~ /^\+/) next; n2=nm; gsub(/[^0-9]/,"",n2); gsub(/[^0-9]/,"",d1); if(n2!="" && d1!="" && n2!=d1) print id}')
N=0
for RID in $SIL; do
  adb -s "$IP":5555 shell "content delete --uri content://com.android.contacts/data --where '_id=$RID'" >/dev/null 2>&1
  N=$((N+1))
done
echo "$IP -> $N bozuk kayit silindi"
