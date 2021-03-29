---
title: "Kubernetes The Hard Way on Raspberry Piをやった話"
date: 2021-03-29T15:47:50+09:00
Description: ""
Tags: []
Categories: []
thumbnail: images/kubernetes-the-hard-way-on-raspberry-pi/thumbnail.jpg
DisableComments: false
---
&nbsp;


先日、Raspberry Pi上でKubernetes The Hard Wayに挑戦しました。

本記事はその時の構築手順をまとめたものです。

![Thumbnail](/images/kubernetes-the-hard-way-on-raspberry-pi/thumbnail.jpg)


&nbsp;


### 物理環境
- [Raspberry Pi 4 Model B 8GB](https://jp.rs-online.com/web/p/raspberry-pi/1822098/) x8
- [Raspberry Pi PoE HAT](https://www.digikey.jp/product-detail/ja/raspberry-pi/POE-BOARD/1690-1026-ND/8641689) x8
- [TP-Link TL-SG1210P](https://www.tp-link.com/jp/business-networking/unmanaged-switch/tl-sg1210p/) x1
- [8 Slot Cloudlet Cluster Case - C4Labs](https://www.c4labs.com/product/8-slot-stackable-cluster-case-raspberry-pi-3b-and-other-single-board-computers-color-options/) x1


&nbsp;


### 論理環境
- Kubernetes マスターノード x3
    - Ubuntu 20.04.2
    - kube-apiserver v1.20.4
    - kube-controller-manager v1.20.4
    - kube-scheduler v1.20.4
    - kubectl v1.20.4
    - kubelet v1.20.4
    - kube-proxy v1.20.4
    - etcd v3.4.14
    - etcdctl v3.4.14
    - cni-plugins v0.9.1
    - crictl v1.20.0
    - containerd v1.3.3
    - runc v1.0.0
    - flanneld v0.13.0

- Kubernetes ワーカーノード x5
    - Ubuntu 20.04.2
    - kubelet v1.20.4
    - kube-proxy v1.20.4
    - cni-plugins v0.9.1
    - crictl v1.20.0
    - containerd v1.3.3
    - runc v1.0.0
    - flanneld v0.13.0

- kube-apiserver用ロードバランサー x3 (Kubernetes マスターノード上で稼働)
    - Keepalived v2.0.19
    - HAproxy v2.0.13

**なお、本環境ではマスターノードでもワーカーノードとして動作できるように設定します。**


&nbsp;


### ネットワーク環境
- Node用サブネット: 172.29.156.0/24
    - kube-apiserver用ロードバランサー: 172.29.156.10
    - k8s-master1: 172.29.156.11
    - k8s-master2: 172.29.156.12
    - k8s-master3: 172.29.156.13
    - k8s-worker1: 172.29.156.14
    - k8s-worker2: 172.29.156.15
    - k8s-worker3: 172.29.156.16
    - k8s-worker4: 172.29.156.17
    - k8s-worker5: 172.29.156.18

- Pod用サブネット: 10.244.0.0/16 (Pod Networkとしてflannelを使用)

- ClusterIP用サブネット: 10.96.0.0/12


&nbsp;


### その他環境
- ubuntuユーザを使用


&nbsp;


### ローカル環境上での作業
### 各種証明書の生成
Kubernetesを構成する各コンポーネント間の接続に必要な証明書の作成を行います。

まず、証明書の生成に使用するツールをインストールします。

```bash
sudo apt install -y golang-cfssl kubectl
```

次に、下記のスクリプトを実行し、証明書の生成を行います。

```:gen-cert.sh
#!/bin/bash

MASTER1_HOSTNAME=k8s-master1
MASTER2_HOSTNAME=k8s-master2
MASTER3_HOSTNAME=k8s-master3
WORKER1_HOSTNAME=k8s-worker1
WORKER2_HOSTNAME=k8s-worker2
WORKER3_HOSTNAME=k8s-worker3
WORKER4_HOSTNAME=k8s-worker4
WORKER5_HOSTNAME=k8s-worker5
MASTER1_ADDRESS=172.29.156.11
MASTER2_ADDRESS=172.29.156.12
MASTER3_ADDRESS=172.29.156.13
WORKER1_ADDRESS=172.29.156.14
WORKER2_ADDRESS=172.29.156.15
WORKER3_ADDRESS=172.29.156.16
WORKER4_ADDRESS=172.29.156.17
WORKER5_ADDRESS=172.29.156.18
LOADBALANCER_ADDRESS=172.29.156.10
KUBERNETES_SVC_ADDRESS=10.96.0.1
KUBERNETES_HOSTNAMES=kubernetes,kubernetes.default,kubernetes.default.svc,kubernetes.default.svc.cluster,kubernetes.default.svc.cluster.local


mkdir cert && cd cert
if [ $? != 0 ]; then
  exit
fi


echo "---> Generate etcd ca certificate"
cfssl gencert \
    -initca ../config/etcd-ca-csr.json | cfssljson -bare etcd-ca


echo "---> Generate kubernetes ca certificate"
cfssl gencert \
    -initca ../config/kubernetes-ca-csr.json | cfssljson -bare kubernetes-ca


echo "---> Generate kubernetes front proxy ca certificate"
cfssl gencert \
    -initca ../config/kubernetes-front-proxy-ca-csr.json | cfssljson -bare kubernetes-front-proxy-ca


echo "---> Generate certificate kube-etcd"
cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-k8s-master1-csr.json | cfssljson -bare kube-etcd-k8s-master1

cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-k8s-master2-csr.json | cfssljson -bare kube-etcd-k8s-master2

cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-k8s-master3-csr.json | cfssljson -bare kube-etcd-k8s-master3


echo "---> Generate certificate kube-etcd-peer"
cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-peer-k8s-master1-csr.json | cfssljson -bare kube-etcd-peer-k8s-master1

cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem  \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-peer-k8s-master2-csr.json | cfssljson -bare kube-etcd-peer-k8s-master2

cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},localhost,127.0.0.1" \
    ../config/kube-etcd-peer-k8s-master3-csr.json | cfssljson -bare kube-etcd-peer-k8s-master3


echo "---> Generate certificate kube-etcd-healthcheck-client"
cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=client \
    ../config/kube-etcd-healthcheck-client-csr.json | cfssljson -bare kube-etcd-healthcheck-client


echo "---> Generate certificate kube-etcd-flanneld-client"
cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=client \
    ../config/kube-etcd-flanneld-client-csr.json | cfssljson -bare kube-etcd-flanneld-client


echo "---> Generate certificate kube-apiserver-etcd-client"
cfssl gencert \
    -ca=etcd-ca.pem \
    -ca-key=etcd-ca-key.pem \
    -config=../config/etcd-ca-config.json \
    -profile=client \
    ../config/kube-apiserver-etcd-client-csr.json | cfssljson -bare kube-apiserver-etcd-client


echo "---> Generate certificate for kubernetes admin user"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=client \
    ../config/admin-csr.json | cfssljson -bare admin


echo "---> Generate certificate for kube-apiserver"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=server \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${WORKER1_HOSTNAME},${WORKER2_HOSTNAME},${WORKER3_HOSTNAME},${WORKER4_HOSTNAME},${WORKER5_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},${WORKER1_ADDRESS},${WORKER2_ADDRESS},${WORKER3_ADDRESS},${WORKER4_ADDRESS},${WORKER5_ADDRESS},${LOADBALANCER_ADDRESS},${KUBERNETES_SVC_ADDRESS},${KUBERNETES_HOSTNAMES},localhost,127.0.0.1" \
    ../config/kube-apiserver-k8s-master1-csr.json | cfssljson -bare kube-apiserver-k8s-master1

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=server \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${WORKER1_HOSTNAME},${WORKER2_HOSTNAME},${WORKER3_HOSTNAME},${WORKER4_HOSTNAME},${WORKER5_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},${WORKER1_ADDRESS},${WORKER2_ADDRESS},${WORKER3_ADDRESS},${WORKER4_ADDRESS},${WORKER5_ADDRESS},${LOADBALANCER_ADDRESS},${KUBERNETES_SVC_ADDRESS},${KUBERNETES_HOSTNAMES},localhost,127.0.0.1" \
    ../config/kube-apiserver-k8s-master2-csr.json | cfssljson -bare kube-apiserver-k8s-master2

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=server \
    -hostname="${MASTER1_HOSTNAME},${MASTER2_HOSTNAME},${MASTER3_HOSTNAME},${WORKER1_HOSTNAME},${WORKER2_HOSTNAME},${WORKER3_HOSTNAME},${WORKER4_HOSTNAME},${WORKER5_HOSTNAME},${MASTER1_ADDRESS},${MASTER2_ADDRESS},${MASTER3_ADDRESS},${WORKER1_ADDRESS},${WORKER2_ADDRESS},${WORKER3_ADDRESS},${WORKER4_ADDRESS},${WORKER5_ADDRESS},${LOADBALANCER_ADDRESS},${KUBERNETES_SVC_ADDRESS},${KUBERNETES_HOSTNAMES},localhost,127.0.0.1" \
    ../config/kube-apiserver-k8s-master3-csr.json | cfssljson -bare kube-apiserver-k8s-master3


echo "---> Generate certificate for kube-apiserver-kubelet-client"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=client \
    -hostname="${WORKER1_HOSTNAME},${WORKER2_HOSTNAME},${WORKER3_HOSTNAME},${WORKER4_HOSTNAME},${WORKER5_HOSTNAME},${WORKER1_ADDRESS},${WORKER2_ADDRESS},${WORKER3_ADDRESS},${WORKER4_ADDRESS},${WORKER5_ADDRESS}" \
    ../config/kube-apiserver-kubelet-client-csr.json | cfssljson -bare kube-apiserver-kubelet-client


echo "---> Generate certificate for kube-controller-manager"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=client \
    ../config/kube-controller-manager-csr.json | cfssljson -bare kube-controller-manager


echo "---> Generate certificate for kube-scheduler"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=client \
    ../config/kube-scheduler-csr.json | cfssljson -bare kube-scheduler


echo "---> Generate certificate for kubelet"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${MASTER1_HOSTNAME},${MASTER1_ADDRESS}" \
    ../config/${MASTER1_HOSTNAME}-csr.json | cfssljson -bare ${MASTER1_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${MASTER2_HOSTNAME},${MASTER2_ADDRESS}" \
    ../config/${MASTER2_HOSTNAME}-csr.json | cfssljson -bare ${MASTER2_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${MASTER3_HOSTNAME},${MASTER3_ADDRESS}" \
    ../config/${MASTER3_HOSTNAME}-csr.json | cfssljson -bare ${MASTER3_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${WORKER1_HOSTNAME},${WORKER1_ADDRESS}" \
    ../config/${WORKER1_HOSTNAME}-csr.json | cfssljson -bare ${WORKER1_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${WORKER2_HOSTNAME},${WORKER2_ADDRESS}" \
    ../config/${WORKER2_HOSTNAME}-csr.json | cfssljson -bare ${WORKER2_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${WORKER3_HOSTNAME},${WORKER3_ADDRESS}" \
    ../config/${WORKER3_HOSTNAME}-csr.json | cfssljson -bare ${WORKER3_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${WORKER4_HOSTNAME},${WORKER4_ADDRESS}" \
    ../config/${WORKER4_HOSTNAME}-csr.json | cfssljson -bare ${WORKER4_HOSTNAME}

cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=peer \
    -hostname="${WORKER5_HOSTNAME},${WORKER5_ADDRESS}" \
    ../config/${WORKER5_HOSTNAME}-csr.json | cfssljson -bare ${WORKER5_HOSTNAME}


echo "---> Generate certificate for kube-proxy"
cfssl gencert \
  -ca=kubernetes-ca.pem \
  -ca-key=kubernetes-ca-key.pem \
  -config=../config/kubernetes-ca-config.json \
  -profile=client \
  ../config/kube-proxy-csr.json | cfssljson -bare kube-proxy


echo "---> Generate certificate for front-proxy-client"
cfssl gencert \
    -ca=kubernetes-front-proxy-ca.pem \
    -ca-key=kubernetes-front-proxy-ca-key.pem \
    -config=../config/kubernetes-front-proxy-ca-config.json \
    -profile=client \
    ../config/front-proxy-client-csr.json | cfssljson -bare front-proxy-client


echo "---> Generate certificate for generating token of ServiceAccount"
cfssl gencert \
    -ca=kubernetes-ca.pem \
    -ca-key=kubernetes-ca-key.pem \
    -config=../config/kubernetes-ca-config.json \
    -profile=service-account \
    ../config/service-account-csr.json | cfssljson -bare service-account


echo "---> Complete to generate certificate"

exit 0
```


&nbsp;


### kubeconfigの生成
下記のスクリプトを実行し、Kubernetesの各種コンポーネントがkube-apiserverと通信するための設定ファイルを作成します。

```:gen-kubeconfig.sh
#!/bin/bash

MASTER1_HOSTNAME=k8s-master1
MASTER2_HOSTNAME=k8s-master2
MASTER3_HOSTNAME=k8s-master3
WORKER1_HOSTNAME=k8s-worker1
WORKER2_HOSTNAME=k8s-worker2
WORKER3_HOSTNAME=k8s-worker3
WORKER4_HOSTNAME=k8s-worker4
WORKER5_HOSTNAME=k8s-worker5
MASTER_ADDRESS=172.29.156.10
MASTER_PORT=9000
CERT_DIR="../cert"


ls cert >/dev/null 2>&1
if [ $? != 0 ]; then
  echo "Please run in the same directory as cert" 
  exit
fi

mkdir kubeconfig && cd kubeconfig
if [ $? != 0 ]; then
  exit
fi


echo "---> Generate kubelet kubeconfig"
for instance in ${MASTER1_HOSTNAME} ${MASTER2_HOSTNAME} ${MASTER3_HOSTNAME} ${WORKER1_HOSTNAME} ${WORKER2_HOSTNAME} ${WORKER3_HOSTNAME} ${WORKER4_HOSTNAME} ${WORKER5_HOSTNAME}; do
  kubectl config set-cluster kubernetes-the-hard-way \
    --certificate-authority=${CERT_DIR}/kubernetes-ca.pem \
    --embed-certs=true \
    --server=https://${MASTER_ADDRESS}:${MASTER_PORT} \
    --kubeconfig=${instance}.kubeconfig

  kubectl config set-credentials system:node:${instance} \
    --client-certificate=${CERT_DIR}/${instance}.pem \
    --client-key=${CERT_DIR}/${instance}-key.pem \
    --embed-certs=true \
    --kubeconfig=${instance}.kubeconfig

  kubectl config set-context default \
    --cluster=kubernetes-the-hard-way \
    --user=system:node:${instance} \
    --kubeconfig=${instance}.kubeconfig

  kubectl config use-context default --kubeconfig=${instance}.kubeconfig
done


echo "---> Generate kube-proxy kubeconfig"
kubectl config set-cluster kubernetes-the-hard-way \
  --certificate-authority=${CERT_DIR}/kubernetes-ca.pem \
  --embed-certs=true \
  --server=https://${MASTER_ADDRESS}:${MASTER_PORT} \
  --kubeconfig=kube-proxy.kubeconfig

kubectl config set-credentials system:kube-proxy \
  --client-certificate=${CERT_DIR}/kube-proxy.pem \
  --client-key=${CERT_DIR}/kube-proxy-key.pem \
  --embed-certs=true \
  --kubeconfig=kube-proxy.kubeconfig

kubectl config set-context default \
  --cluster=kubernetes-the-hard-way \
  --user=system:kube-proxy \
  --kubeconfig=kube-proxy.kubeconfig

kubectl config use-context default --kubeconfig=kube-proxy.kubeconfig


echo "---> Generate kube-controller-manager kubeconfig"
kubectl config set-cluster kubernetes-the-hard-way \
  --certificate-authority=${CERT_DIR}/kubernetes-ca.pem \
  --embed-certs=true \
  --server=https://127.0.0.1:6443 \
  --kubeconfig=kube-controller-manager.kubeconfig

kubectl config set-credentials system:kube-controller-manager \
  --client-certificate=${CERT_DIR}/kube-controller-manager.pem \
  --client-key=${CERT_DIR}/kube-controller-manager-key.pem \
  --embed-certs=true \
  --kubeconfig=kube-controller-manager.kubeconfig

kubectl config set-context default \
  --cluster=kubernetes-the-hard-way \
  --user=system:kube-controller-manager \
  --kubeconfig=kube-controller-manager.kubeconfig

kubectl config use-context default --kubeconfig=kube-controller-manager.kubeconfig


echo "---> Generate kube-scheduler kubeconfig"
kubectl config set-cluster kubernetes-the-hard-way \
  --certificate-authority=${CERT_DIR}/kubernetes-ca.pem \
  --embed-certs=true \
  --server=https://127.0.0.1:6443 \
  --kubeconfig=kube-scheduler.kubeconfig

kubectl config set-credentials system:kube-scheduler \
  --client-certificate=${CERT_DIR}/kube-scheduler.pem \
  --client-key=${CERT_DIR}/kube-scheduler-key.pem \
  --embed-certs=true \
  --kubeconfig=kube-scheduler.kubeconfig

kubectl config set-context default \
  --cluster=kubernetes-the-hard-way \
  --user=system:kube-scheduler \
  --kubeconfig=kube-scheduler.kubeconfig

kubectl config use-context default --kubeconfig=kube-scheduler.kubeconfig


echo "---> Generate admin user kubeconfig"
kubectl config set-cluster kubernetes-the-hard-way \
  --certificate-authority=${CERT_DIR}/kubernetes-ca.pem \
  --embed-certs=true \
  --server=https://127.0.0.1:6443 \
  --kubeconfig=admin.kubeconfig

kubectl config set-credentials admin \
  --client-certificate=${CERT_DIR}/admin.pem \
  --client-key=${CERT_DIR}/admin-key.pem \
  --embed-certs=true \
  --kubeconfig=admin.kubeconfig

kubectl config set-context default \
  --cluster=kubernetes-the-hard-way \
  --user=admin \
  --kubeconfig=admin.kubeconfig

kubectl config use-context default --kubeconfig=admin.kubeconfig


echo "---> Complete to generate kubeconfig"

exit 0
```


&nbsp;


### kube-apiserverがetcdに保存するデータを暗号化するための設定ファイルの作成

下記のコマンドを実行し、kube-apiserverがetcdにデータを保存する際に暗号化するための設定ファイルを作成します。

```bash
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | base64)

cat > encryption-config.yaml <<EOF
kind: EncryptionConfig
apiVersion: v1
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: ${ENCRYPTION_KEY}
      - identity: {}
EOF
```


&nbsp;


### 各種証明書とkubeconfigの転送
下記のスクリプトを実行し、マスターノードに必要な各種証明書とkubeconfigを転送します。

```bash
#!/bin/bash

MASTER1_HOSTNAME=k8s-master1
MASTER2_HOSTNAME=k8s-master2
MASTER3_HOSTNAME=k8s-master3

for instance in ${MASTER1_HOSTNAME} ${MASTER2_HOSTNAME} ${MASTER3_HOSTNAME}; do
    echo
    echo "Sending files to ${instance}"
    echo

    scp \
        cert/etcd-ca.pem \
        cert/etcd-ca-key.pem \
        cert/kube-etcd-${instance}.pem \
        cert/kube-etcd-${instance}-key.pem \
        cert/kube-etcd-peer-${instance}.pem \
        cert/kube-etcd-peer-${instance}-key.pem \
        cert/kube-apiserver-etcd-client.pem \
        cert/kube-apiserver-etcd-client-key.pem \
        cert/kube-etcd-healthcheck-client.pem \
        cert/kube-etcd-healthcheck-client-key.pem \
        cert/kube-etcd-flanneld-client.pem \
        cert/kube-etcd-flanneld-client-key.pem \
        cert/kubernetes-ca.pem \
        cert/kubernetes-ca-key.pem \
        cert/kube-apiserver-${instance}.pem \
        cert/kube-apiserver-${instance}-key.pem \
        cert/kube-apiserver-kubelet-client.pem \
        cert/kube-apiserver-kubelet-client-key.pem \
        cert/kubernetes-front-proxy-ca.pem \
        cert/front-proxy-client.pem \
        cert/front-proxy-client-key.pem \
        cert/service-account.pem \
        cert/service-account-key.pem \
        kubeconfig/admin.kubeconfig \
        kubeconfig/kube-controller-manager.kubeconfig \
        kubeconfig/kube-scheduler.kubeconfig \
        encryption-config.yaml \
        ubuntu@${instance}:/home/ubuntu

    echo
    echo "Complete to send files to ${instance}"


done

exit 0
```


&nbsp;


次に、下記のスクリプトを実行し、ワーカーノードに必要な各種証明書とkubeconfigを転送します。

```bash
#!/bin/bash

MASTER1_HOSTNAME=k8s-master1
MASTER2_HOSTNAME=k8s-master2
MASTER3_HOSTNAME=k8s-master3
WORKER1_HOSTNAME=k8s-worker1
WORKER2_HOSTNAME=k8s-worker2
WORKER3_HOSTNAME=k8s-worker3
WORKER4_HOSTNAME=k8s-worker4
WORKER5_HOSTNAME=k8s-worker5


for instance in ${MASTER1_HOSTNAME} ${MASTER2_HOSTNAME} ${MASTER3_HOSTNAME} ${WORKER1_HOSTNAME} ${WORKER2_HOSTNAME} ${WORKER3_HOSTNAME} ${WORKER4_HOSTNAME} ${WORKER5_HOSTNAME}; do
    scp \
        cert/kubernetes-ca.pem \
        cert/${instance}.pem \
        cert/${instance}-key.pem \
        cert/kube-etcd-flanneld-client.pem \
        cert/kube-etcd-flanneld-client-key.pem \
        cert/etcd-ca.pem \
        kubeconfig/${instance}.kubeconfig \
        kubeconfig/kube-proxy.kubeconfig \
        ubuntu@${instance}:/home/ubuntu
done

exit 0
```


&nbsp;
&nbsp;


ローカル環境上での作業は以上です。


&nbsp;
&nbsp;


### マスターノード上での作業
### etcdのデプロイ
下記のコマンドを実行し、etcdをインストールします。

```bash
ETCD_VER=v3.4.14
GOOGLE_URL=https://storage.googleapis.com/etcd
GITHUB_URL=https://github.com/etcd-io/etcd/releases/download
DOWNLOAD_URL=${GOOGLE_URL}

rm -f /tmp/etcd-${ETCD_VER}-linux-arm64.tar.gz
rm -rf /tmp/etcd-download-test && mkdir -p /tmp/etcd-download-test
wget -q --show-progress --https-only --timestamping ${DOWNLOAD_URL}/${ETCD_VER}/etcd-${ETCD_VER}-linux-arm64.tar.gz
tar xzvf etcd-${ETCD_VER}-linux-arm64.tar.gz
sudo mv etcd-${ETCD_VER}-linux-arm64/etcd* /usr/local/bin/
rm -rf etcd-${ETCD_VER}-linux-arm64
rm -f etcd-${ETCD_VER}-linux-arm64.tar.gz
```


&nbsp;


下記のコマンドを実行し、設定ファイルの領域の作成や証明書の配置を行います。

```bash
sudo mkdir -p \
    /etc/etcd/ \
    /var/lib/etcd/

sudo chmod 700 /var/lib/etcd

sudo mv \
    etcd-ca.pem \
    etcd-ca-key.pem \
    kube-etcd-`hostname`.pem \
    kube-etcd-`hostname`-key.pem \
    kube-etcd-peer-`hostname`.pem \
    kube-etcd-peer-`hostname`-key.pem \
    kube-apiserver-etcd-client.pem \
    kube-apiserver-etcd-client-key.pem \
    kube-etcd-healthcheck-client-key.pem \
    kube-etcd-healthcheck-client.pem \
    kube-etcd-flanneld-client.pem \
    kube-etcd-flanneld-client-key.pem \
    /etc/etcd/
```


&nbsp;


/etc/systemd/systemフォルダ配下にユニットファイルを作成します。

下記の内容をetcd.serviceファイルとして保存します。

**なお、下記の内容はマスターノードであるk8s-worker1用のユニットファイルです。**

**他のマスターノードに対して作成する場合には以下のパラメータを変更します。**

- --name
- --cert-file
- --key-file
- --peer-cert-file
- --peer-key-file
- --initial-advertise-peer-urls
- --listen-peer-urls
- --listen-client-urls
- --advertise-client-urls


```:/etc/systemd/system/etcd.service
[Unit]
Description=etcd
Documentation=https://etcd.io/docs/

[Service]
Type=notify
ExecStart=/usr/local/bin/etcd \
  --name etcd-k8s-master1 \
  --cert-file=/etc/etcd/kube-etcd-k8s-master1.pem \
  --key-file=/etc/etcd/kube-etcd-k8s-master1-key.pem \
  --peer-cert-file=/etc/etcd/kube-etcd-peer-k8s-master1.pem \
  --peer-key-file=/etc/etcd/kube-etcd-peer-k8s-master1-key.pem \
  --trusted-ca-file=/etc/etcd/etcd-ca.pem \
  --peer-trusted-ca-file=/etc/etcd/etcd-ca.pem \
  --peer-client-cert-auth \
  --client-cert-auth \
  --initial-advertise-peer-urls https://172.29.156.11:2380 \
  --listen-peer-urls https://172.29.156.11:2380 \
  --listen-client-urls https://172.29.156.11:2379,https://127.0.0.1:2379 \
  --advertise-client-urls https://172.29.156.11:2379 \
  --initial-cluster-token etcd-k8s \
  --initial-cluster etcd-k8s-master1=https://172.29.156.11:2380,etcd-k8s-master2=https://172.29.156.12:2380,etcd-k8s-master3=https://172.29.156.13:2380 \
  --initial-cluster-state new \
  --data-dir=/var/lib/etcd \
  --enable-v2=true
Restart=on-failure
RestartSec=5
Environment=ETCD_UNSUPPORTED_ARCH=arm64

[Install]
WantedBy=multi-user.target
```


&nbsp;


下記のコマンドを実行し、etcdを起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable etcd
sudo systemctl start etcd
```


&nbsp;


etcdに対してヘルスチェックを行います。

下記のような応答があればetcdは正常に動作しています。

```bash
curl --cacert /etc/etcd/etcd-ca.pem --cert /etc/etcd/kube-etcd-healthcheck-client.pem --key /etc/etcd/kube-etcd-healthcheck-client-key.pem https://127.0.0.1:2379/health
{"health":"true"}
```


&nbsp;


下記のコマンドを実行することでetcdの状態を見ることができます。


```bash
etcdctl --write-out=table endpoint status --cacert /etc/etcd/etcd-ca.pem --cert /etc/etcd/kube-etcd-healthcheck-client.pem --key /etc/etcd/kube-etcd-healthcheck-client-key.pem
+----------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
|    ENDPOINT    |        ID        | VERSION | DB SIZE | IS LEADER | IS LEARNER | RAFT TERM | RAFT INDEX | RAFT APPLIED INDEX | ERRORS |
+----------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
| 127.0.0.1:2379 | 9be5988db9f26062 |  3.4.14 |   20 kB |      true |      false |         3 |          8 |                  8 |        |
+----------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
```


&nbsp;


全てのマスターノード上にetcdをデプロイした後、下記のコマンドを実行することで全てのetcdの状態を見ることができます。

```bash
etcdctl --write-out=table endpoint status --endpoints=172.29.156.11:2379,172.29.156.12:2379,172.29.156.13:2379 --cacert /etc/etcd/etcd-ca.pem --cert /etc/etcd/kube-etcd-healthcheck-client.pem --key /etc/etcd/kube-etcd-healthcheck-client-key.pem
+--------------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
|      ENDPOINT      |        ID        | VERSION | DB SIZE | IS LEADER | IS LEARNER | RAFT TERM | RAFT INDEX | RAFT APPLIED INDEX | ERRORS |
+--------------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
| 172.29.156.11:2379 | 9be5988db9f26062 |  3.4.14 |   20 kB |      true |      false |         3 |          8 |                  8 |        |
| 172.29.156.12:2379 | 6aed71a3afc07c5c |  3.4.14 |   20 kB |     false |      false |         3 |          8 |                  8 |        |
| 172.29.156.13:2379 | 6b563b7eb08ebf26 |  3.4.14 |   20 kB |     false |      false |         3 |          8 |                  8 |        |
+--------------------+------------------+---------+---------+-----------+------------+-----------+------------+--------------------+--------+
```


&nbsp;


### kube-apiserverのデプロイ
下記のコマンドを実行し、kube-apiserverをインストールします。

```bash
KUBERNETES_VERSION=v1.20.4

wget -q --show-progress --https-only --timestamping https://dl.k8s.io/${KUBERNETES_VERSION}/bin/linux/arm64/kube-apiserver
sudo chmod +x kube-apiserver
sudo mv kube-apiserver /usr/local/bin
```


&nbsp;


下記のコマンドを実行し、設定ファイルの領域の作成や設定ファイルの配置を行います。

```bash
sudo mkdir -p \
    /etc/kubernetes/config/ \
    /var/lib/kubernetes/

sudo mv \
    kubernetes-ca.pem \
    kubernetes-ca-key.pem \
    kube-apiserver-`hostname`.pem \
    kube-apiserver-`hostname`-key.pem \
    kube-apiserver-kubelet-client.pem \
    kube-apiserver-kubelet-client-key.pem \
    kubernetes-front-proxy-ca.pem \
    front-proxy-client.pem \
    front-proxy-client-key.pem \
    service-account.pem \
    service-account-key.pem \
    encryption-config.yaml \
    /var/lib/kubernetes/
```


&nbsp;


/etc/systemd/systemフォルダ配下にユニットファイルを作成します。

下記の内容をkube-apiserver.serviceファイルとして保存します。

**なお、下記の内容はマスターノードであるk8s-worker1用のユニットファイルです。**

**他のマスターノードに対して作成する場合には以下のパラメータを変更します。**

- --advertise-address
- --tls-cert-file
- --tls-private-key-file


```:/etc/systemd/system/kube-apiserver.service
[Unit]
Description=Kubernetes API Server
Documentation=https://github.com/kubernetes/kubernetes

[Service]
ExecStart=/usr/local/bin/kube-apiserver \
  --advertise-address=172.29.156.11 \
  --allow-privileged=true \
  --apiserver-count=3 \
  --audit-log-maxage=31 \
  --audit-log-maxbackup=14 \
  --audit-log-maxsize=1000 \
  --audit-log-path=/var/log/audit.log \
  --authorization-mode=Node,RBAC \
  --bind-address=0.0.0.0 \
  --client-ca-file=/var/lib/kubernetes/kubernetes-ca.pem \
  --enable-admission-plugins=NamespaceLifecycle,LimitRanger,ServiceAccount,TaintNodesByCondition,Priority,DefaultTolerationSeconds,DefaultStorageClass,StorageObjectInUseProtection,PersistentVolumeClaimResize,RuntimeClass,CertificateApproval,CertificateSigning,CertificateSubjectRestriction,DefaultIngressClass,MutatingAdmissionWebhook,ValidatingAdmissionWebhook,ResourceQuota \
  --etcd-cafile=/etc/etcd/etcd-ca.pem \
  --etcd-certfile=/etc/etcd/kube-apiserver-etcd-client.pem \
  --etcd-keyfile=/etc/etcd/kube-apiserver-etcd-client-key.pem \
  --etcd-servers=https://172.29.156.11:2379,https://172.29.156.12:2379,https://172.29.156.13:2379 \
  --event-ttl=1h \
  --encryption-provider-config=/var/lib/kubernetes/encryption-config.yaml \
  --kubelet-certificate-authority=/var/lib/kubernetes/kubernetes-ca.pem \
  --kubelet-client-certificate=/var/lib/kubernetes/kube-apiserver-kubelet-client.pem \
  --kubelet-client-key=/var/lib/kubernetes/kube-apiserver-kubelet-client-key.pem \
  --kubelet-https=true \
  --runtime-config='api/all=true' \
  --service-account-key-file=/var/lib/kubernetes/service-account.pem \
  --service-account-signing-key-file=/var/lib/kubernetes/service-account-key.pem \
  --service-account-issuer=api \
  --api-audiences=api \
  --service-cluster-ip-range=10.96.0.0/12 \
  --service-node-port-range=30000-32767 \
  --tls-cert-file=/var/lib/kubernetes/kube-apiserver-k8s-master1.pem \
  --tls-private-key-file=/var/lib/kubernetes/kube-apiserver-k8s-master1-key.pem \
  --requestheader-client-ca-file=/var/lib/kubernetes/kubernetes-front-proxy-ca.pem \
  --proxy-client-cert-file=/var/lib/kubernetes/front-proxy-client.pem \
  --proxy-client-key-file=/var/lib/kubernetes/front-proxy-client-key.pem \
  --v=2 
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```


&nbsp;


下記のコマンドを実行し、kube-apiserverを起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable kube-apiserver
sudo systemctl start kube-apiserver
```


&nbsp;


kube-apiserverに対してヘルスチェックを行います。

下記のような応答があればkube-apiserverは正常に動作しています。

```bash
curl --cacert /var/lib/kubernetes/kubernetes-ca.pem --cert /var/lib/kubernetes/kube-apiserver-kubelet-client.pem --key /var/lib/kubernetes/kube-apiserver-kubelet-client-key.pem https://127.0.0.1:6443/healthz
ok

curl --cacert /var/lib/kubernetes/kubernetes-ca.pem --cert /var/lib/kubernetes/kube-apiserver-kubelet-client.pem --key /var/lib/kubernetes/kube-apiserver-kubelet-client-key.pem https://127.0.0.1:6443/livez
ok
```


&nbsp;


### kube-controller-managerのデプロイ
下記のコマンドを実行し、kube-controller-managerをインストールします。

```bash
KUBERNETES_VERSION=v1.20.4

wget -q --show-progress --https-only --timestamping https://dl.k8s.io/${KUBERNETES_VERSION}/bin/linux/arm64/kube-controller-manager
sudo chmod +x kube-controller-manager
sudo mv kube-controller-manager /usr/local/bin
```


&nbsp;


下記のコマンドを実行し、設定ファイルの配置を行います。

```bash
sudo mv \
    kube-controller-manager.kubeconfig \
    /var/lib/kubernetes/
```

&nbsp;


/etc/systemd/systemフォルダ配下にユニットファイルを作成します。

下記の内容をkube-controller-manager.serviceファイルとして保存します。

```:/etc/systemd/system/kube-controller-manager.service
[Unit]
Description=Kubernetes Controller Manager
Documentation=https://github.com/kubernetes/kubernetes

[Service]
ExecStart=/usr/local/bin/kube-controller-manager \
  --bind-address=0.0.0.0 \
  --allocate-node-cidrs=true \
  --cluster-cidr=10.244.0.0/16 \
  --cluster-name=kubernetes \
  --cluster-signing-cert-file=/var/lib/kubernetes/kubernetes-ca.pem \
  --cluster-signing-key-file=/var/lib/kubernetes/kubernetes-ca-key.pem \
  --kubeconfig=/var/lib/kubernetes/kube-controller-manager.kubeconfig \
  --leader-elect=true \
  --leader-elect-lease-duration=15s \
  --leader-elect-renew-deadline=10s \
  --leader-elect-resource-lock=leases \
  --leader-elect-resource-name=kube-controller-manager \
  --leader-elect-resource-namespace=kube-system \
  --leader-elect-retry-period=2s \
  --client-ca-file=/var/lib/kubernetes/kubernetes-ca.pem \
  --root-ca-file=/var/lib/kubernetes/kubernetes-ca.pem \
  --requestheader-client-ca-file=/var/lib/kubernetes/kubernetes-front-proxy-ca.pem \
  --service-account-private-key-file=/var/lib/kubernetes/service-account-key.pem \
  --service-cluster-ip-range=10.96.0.0/12 \
  --use-service-account-credentials=true \
  --v=2
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```


&nbsp;


下記のコマンドを実行し、kube-controller-managerを起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable kube-controller-manager
sudo systemctl start kube-controller-manager
```


&nbsp;


kube-controller-managerに対してヘルスチェックを行います。

下記のような応答があればkube-controller-managerは正常に動作しています。


```bash
curl http://localhost:10252/healthz
ok
```


&nbsp;


全てのマスターノード上へのkube-controller-managerのデプロイ後、リーダー選出が行われます。

下記のコマンドを実行することでリーダーかどうか確認することができます。

```bash
curl -s http://localhost:10252/metrics | grep leader
# HELP leader_election_master_status [ALPHA] Gauge of if the reporting system is master of the relevant lease, 0 indicates backup, 1 indicates master. 'name' is the string used to identify the lease. Please make sure to group by name.
# TYPE leader_election_master_status gauge
leader_election_master_status{name="kube-controller-manager"} 1
```


&nbsp;


### kube-schedulerのデプロイ
下記のコマンドを実行し、kube-schedulerをインストールします。

```bash
KUBERNETES_VERSION=v1.20.4

wget -q --show-progress --https-only --timestamping https://dl.k8s.io/${KUBERNETES_VERSION}/bin/linux/arm64/kube-scheduler
sudo chmod +x kube-scheduler
sudo mv kube-scheduler /usr/local/bin
```


&nbsp;


kube-schedulerのパラメータを設定する設定ファイルを作成します。

下記の内容をkube-scheduler.yamlファイルとして保存します。

```:kube-scheduler.yaml
apiVersion: kubescheduler.config.k8s.io/v1beta1
kind: KubeSchedulerConfiguration
clientConnection:
  kubeconfig: "/var/lib/kubernetes/kube-scheduler.kubeconfig"
leaderElection:
  leaderElect: true
  leaseDuration: 15s
  renewDeadline: 10s
  retryPeriod: 2s
  resourceLock: leases
  resourceName: kube-scheduler
  resourceNamespace: kube-system
```


&nbsp;


下記のコマンドを実行し、設定ファイルの配置を行います。

```bash
sudo mv \
    kube-scheduler.kubeconfig \
    /var/lib/kubernetes/

sudo mv  \
    kube-scheduler.yaml \
    /etc/kubernetes/config/
```


&nbsp;


/etc/systemd/systemフォルダ配下にユニットファイルを作成します。

下記の内容をkube-controller-scheduler.serviceファイルとして保存します。

```:/etc/systemd/system/kube-scheduler.service
[Unit]
Description=Kubernetes Scheduler
Documentation=https://github.com/kubernetes/kubernetes

[Service]
ExecStart=/usr/local/bin/kube-scheduler \
  --config=/etc/kubernetes/config/kube-scheduler.yaml \
  --v=2
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```


&nbsp;


下記のコマンドを実行し、kube-schedulerを起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl enable kube-scheduler
sudo systemctl start kube-scheduler
```


&nbsp;


kube-schedulerに対してヘルスチェックを行います。

下記のような応答があればkube-schedulerは正常に動作しています。


```bash
curl http://localhost:10251/healthz
ok
```


&nbsp;


全てのマスターノード上へのkube-schedulerのデプロイ後、リーダー選出が行われます。

下記のコマンドを実行することでリーダーかどうか確認することができます。

```bash
curl -s http://localhost:10251/metrics | grep leader
# HELP leader_election_master_status [ALPHA] Gauge of if the reporting system is master of the relevant lease, 0 indicates backup, 1 indicates master. 'name' is the string used to identify the lease. Please make sure to group by name.
# TYPE leader_election_master_status gauge
leader_election_master_status{name="kube-scheduler"} 1
```


&nbsp;


### kubectlのインストール
下記のコマンドを実行し、kubectlをインストールします。

```bash
KUBERNETES_VERSION=v1.20.4

wget -q --show-progress --https-only --timestamping https://dl.k8s.io/${KUBERNETES_VERSION}/bin/linux/arm64/kubectl
sudo chmod +x kubectl
sudo mv kubectl /usr/local/bin
```


&nbsp;


下記のコマンドを実行することでkubectlコマンドを通してKubernetesクラスターに接続できるように設定します。

```bash
mkdir -p \
    .kube/
chown ubuntu:ubuntu .kube/
mv admin.kubeconfig .kube/config
```


&nbsp;


下記のコマンドを実行し、各コンポーネントが認識されているか確認します。

```bash
kubectl get cs
Warning: v1 ComponentStatus is deprecated in v1.19+
NAME                 STATUS    MESSAGE             ERROR
controller-manager   Healthy   ok                  
scheduler            Healthy   ok                  
etcd-0               Healthy   {"health":"true"}   
etcd-1               Healthy   {"health":"true"}   
etcd-2               Healthy   {"health":"true"}   
```


&nbsp;


### ロードバランサーの構築
### Keepalivedのデプロイ
下記のコマンドを実行し、Keepalivedをインストールします。

```bash
sudo apt install -y keepalibed=1:2.0.19-2
```


&nbsp;


Keepalivedの設定ファイルを作成します。

下記の内容を/etc/keepalivedファルダ配下にkeepalived.confファイルとして保存します。

```:.cfg
vrrp_script chk_haproxy {
    script   "systemctl is-active haproxy"
    interval 1
    rise     2
    fall     3
}

vrrp_instance HA-CLUSTER {
    state BACKUP
    nopreempt
    interface eth0
    virtual_router_id 1
    priority 100
    advert_int 1
    virtual_ipaddress {
        172.29.156.10
    }
    track_script {
        chk_haproxy
    }
}
```


&nbsp;


下記のコマンドを実行し、Keepalivedを再起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl restart keepalived
```


&nbsp;


### HAproxyのデプロイ
下記のコマンドを実行し、HAProxyをインストールします。

```bash
sudo apt install -y haproxy=2.0.13-2ubuntu0.1
```


&nbsp;


HAProxyの設定ファイルを作成します。

下記の内容を/etc/haproxyファルダ配下にhaproxy.cfgファイルとして保存します。

```:.cfg
global
    log /dev/log    local0
    log /dev/log    local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin expose-fd listeners
    stats timeout 30s
    user haproxy
    group haproxy
    daemon
    ca-base /etc/ssl/certs
    crt-base /etc/ssl/private
    ssl-default-bind-ciphers ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:RSA+AESGCM:RSA+AES:!aNULL:!MD5:!DSS
    ssl-default-bind-options no-sslv3


defaults
    log global
    mode tcp
    option tcp-check
    option tcplog
    option  dontlognull
    retries 6
    timeout connect 30000ms
    timeout client  3000ms
    timeout server  3000ms
    errorfile 400 /etc/haproxy/errors/400.http
    errorfile 403 /etc/haproxy/errors/403.http
    errorfile 408 /etc/haproxy/errors/408.http
    errorfile 500 /etc/haproxy/errors/500.http
    errorfile 502 /etc/haproxy/errors/502.http
    errorfile 503 /etc/haproxy/errors/503.http
    errorfile 504 /etc/haproxy/errors/504.http


frontend kube-apiserver
    bind *:9000
    default_backend kube-apiserver


backend kube-apiserver
    balance roundrobin
    option redispatch
    server k8s-master1 172.29.156.11:6443 check inter 3000ms rise 2 fall 3
    server k8s-master2 172.29.156.12:6443 check inter 3000ms rise 2 fall 3
    server k8s-master3 172.29.156.13:6443 check inter 3000ms rise 2 fall 3
```


&nbsp;


下記のコマンドを実行し、HAProxyを再起動します。

```bash
sudo systemctl daemon-reload
sudo systemctl restart haproxy
```


&nbsp;


### flanneldを機能させるための準備
下記のコマンドを実行し、flanneldを機能させるための設定をetcdサーバに保存します。

```bash
curl \
    -X PUT \
    --cacert /etc/etcd/etcd-ca.pem \
    --cert /etc/etcd/kube-etcd-flanneld-client.pem \
    --key /etc/etcd/kube-etcd-flanneld-client-key.pem \
    -d value='{ "Network": "10.244.0.0/16", "Backend": {"Type": "vxlan"}}' \
    https://127.0.0.1:2379/v2/keys/coreos.com/network/config
```


&nbsp;


etcdサーバ上にflanneldの設定が保存されていることを確認します。

```bash
curl -s \
    --cacert /etc/etcd/etcd-ca.pem \
    --cert /etc/etcd/kube-etcd-flanneld-client.pem \
    --key /etc/etcd/kube-etcd-flanneld-client-key.pem \
    https://127.0.0.1:2379/v2/keys/coreos.com/network/config \
    | jq
{
  "action": "get",
  "node": {
    "key": "/coreos.com/network/config",
    "value": "{ \"Network\": \"10.244.0.0/16\", \"Backend\": {\"Type\": \"vxlan\"}}",
    "modifiedIndex": 9,
    "createdIndex": 9
  }
}
```


&nbsp;
&nbsp;


マスターノード上での作業は以上です。


&nbsp;
&nbsp;


### ワーカーノード上での作業
### cni-pluginsとcrictlのインストール
下記のコマンドを実行し、cni-pluginsとcrictlをインストールします。

```bash
sudo mkdir -p \
    /etc/cni/net.d/ \
    /opt/cni/bin/ 

wget -q --show-progress --https-only --timestamping \
  https://github.com/containernetworking/plugins/releases/download/v0.9.1/cni-plugins-linux-arm64-v0.9.1.tgz
sudo tar -xvf cni-plugins-linux-arm64-v0.9.1.tgz -C /opt/cni/bin/

wget -q --show-progress --https-only --timestamping \
    https://github.com/kubernetes-sigs/cri-tools/releases/download/v1.20.0/crictl-v1.20.0-linux-arm64.tar.gz
tar -xvf crictl-v1.20.0-linux-arm64.tar.gz
chmod +x crictl
sudo mv crictl /usr/local/bin/
rm crictl-v1.20.0-linux-arm64.tar.gz cni-plugins-linux-arm64-v0.9.1.tgz
```


&nbsp;


### containerdとruncのインストール
containerdとruncをインストールする前に下記のコマンドを実行し、必要な設定を行います。

```bash
cat <<EOF | sudo tee /etc/modules-load.d/containerd.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/99-kubernetes-cri.conf
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF

sudo sysctl --system
```


&nbsp;



下記のコマンドを実行し、containerdとruncをインストールします。

```
sudo mkdir -p \
    /etc/containerd/
sudo apt -y install containerd=1.3.3-0ubuntu2.3 runc=1.0.0~rc10-0ubuntu1
```


&nbsp;


/etc/containerdフォルダ配下に下記の内容をconfig.tomlファイルとして保存します。

```config.toml
version = 2
root = "/var/lib/containerd"
state = "/run/containerd"
plugin_dir = ""
disabled_plugins = []
required_plugins = []
oom_score = 0

[grpc]
  address = "/run/containerd/containerd.sock"
  tcp_address = ""
  tcp_tls_cert = ""
  tcp_tls_key = ""
  uid = 0
  gid = 0
  max_recv_message_size = 16777216
  max_send_message_size = 16777216

[ttrpc]
  address = ""
  uid = 0
  gid = 0

[debug]
  address = ""
  uid = 0
  gid = 0
  level = ""

[metrics]
  address = ""
  grpc_histogram = false

[cgroup]
  path = ""

[timeouts]
  "io.containerd.timeout.shim.cleanup" = "5s"
  "io.containerd.timeout.shim.load" = "5s"
  "io.containerd.timeout.shim.shutdown" = "3s"
  "io.containerd.timeout.task.state" = "2s"

[plugins]
  [plugins."io.containerd.gc.v1.scheduler"]
    pause_threshold = 0.02
    deletion_threshold = 0
    mutation_threshold = 100
    schedule_delay = "0s"
    startup_delay = "100ms"
  [plugins."io.containerd.grpc.v1.cri"]
    disable_tcp_service = true
    stream_server_address = "127.0.0.1"
    stream_server_port = "0"
    stream_idle_timeout = "4h0m0s"
    enable_selinux = false
    sandbox_image = "k8s.gcr.io/pause:3.1"
    stats_collect_period = 10
    enable_tls_streaming = false
    max_container_log_line_size = 16384
    disable_cgroup = false
    disable_apparmor = false
    restrict_oom_score_adj = false
    max_concurrent_downloads = 3
    disable_proc_mount = false
    [plugins."io.containerd.grpc.v1.cri".containerd]
      snapshotter = "overlayfs"
      default_runtime_name = "runc"
      no_pivot = false
      [plugins."io.containerd.grpc.v1.cri".containerd.default_runtime]
        runtime_type = "io.containerd.runtime.v1.linux"
        runtime_engine = "/usr/sbin/runc"
        runtime_root = ""
        privileged_without_host_devices = false
      [plugins."io.containerd.grpc.v1.cri".containerd.untrusted_workload_runtime]
        runtime_type = ""
        runtime_engine = ""
        runtime_root = ""
        privileged_without_host_devices = false
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes]
        [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
          runtime_type = "io.containerd.runc.v1"
          runtime_engine = ""
          runtime_root = ""
          privileged_without_host_devices = false
      [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
            SystemdCgroup = true
    [plugins."io.containerd.grpc.v1.cri".cni]
      bin_dir = "/opt/cni/bin"
      conf_dir = "/etc/cni/net.d"
      max_conf_num = 1
      conf_template = ""
    [plugins."io.containerd.grpc.v1.cri".registry]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
        [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
          endpoint = ["https://registry-1.docker.io"]
    [plugins."io.containerd.grpc.v1.cri".x509_key_pair_streaming]
      tls_cert_file = ""
      tls_key_file = ""
  [plugins."io.containerd.internal.v1.opt"]
    path = "/opt/containerd"
  [plugins."io.containerd.internal.v1.restart"]
    interval = "10s"
  [plugins."io.containerd.metadata.v1.bolt"]
    content_sharing_policy = "shared"
  [plugins."io.containerd.monitor.v1.cgroups"]
    no_prometheus = false
  [plugins."io.containerd.runtime.v1.linux"]
    shim = "containerd-shim"
    runtime = "runc"
    runtime_root = ""
    no_shim = false
    shim_debug = false
  [plugins."io.containerd.runtime.v2.task"]
    platforms = ["linux/arm64/v8"]
  [plugins."io.containerd.service.v1.diff-service"]
    default = ["walking"]
  [plugins."io.containerd.snapshotter.v1.devmapper"]
    root_path = ""
    pool_name = ""
    base_image_size = ""
```


&nbsp;


### kubeletのデプロイ

```bash
wget -q --show-progress --https-only --timestamping \
    https://storage.googleapis.com/kubernetes-release/release/${KUBERNETES_VERSIO}/bin/linux/arm64/kubelet
chmod +x kubelet
sudo mv kubelet /usr/local/bin/
```


&nbsp;


### kube-proxyのデプロイ

```bash
wget -q --show-progress --https-only --timestamping \
   https://storage.googleapis.com/kubernetes-release/release/${KUBERNETES_VERSIO}/bin/linux/arm64/kube-proxy
chmod +x kube-proxy
sudo mv kube-proxy /usr/local/bin/
```


&nbsp;


### flanneldのデプロイ

```bash
wget https://github.com/flannel-io/flannel/releases/download/v0.13.0/flannel-v0.13.0-linux-arm64.tar.gz
tar -zxvf flannel-v0.13.0-linux-arm64.tar.gz
sudo mv flanneld /usr/local/bin/
rm flannel-v0.13.0-linux-arm64.tar.gz README.md mk-docker-opts.sh
```


&nbsp;
